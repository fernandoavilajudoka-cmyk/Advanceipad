#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Reconciliación de la base homologada contra el CRM EN VIVO de Mapon
===================================================================

Jala los datos vivos del CRM (empresas, vehículos, contactos) y los cruza,
por VIN, contra salida/clientes_unidades.csv para:
  · Tomar la FECHA DE ALTA autoritativa del CRM (cars.createDateTime).
  · Detectar VINs en el CRM que no están en la base (y viceversa).
  · Marcar diferencias de empresa / contacto.
  · Refrescar el número de unidades por empresa.

El CRM de Mapon NO tiene un campo nativo de "fecha de renovación": en cars
sólo existe createDateTime / lastDataReceived, y en companies statusTill /
clientCategories. Por eso la fecha de renovación se mantiene en la base
homologada (y, si se desea, se escribe de vuelta como campo personalizado).

SEGURIDAD: el token se lee SÓLO de la variable de entorno MAPON_TOKEN.
Nunca se escribe a disco, logs ni se commitea.

  export MAPON_TOKEN='<jwt>'
  python3 reconciliar_crm.py --probe          # diagnostica 1 llamada y headers
  python3 reconciliar_crm.py                  # reconciliación completa

Notas de la API:
  · Base URL: https://mapon.com/crm-api
  · Auth: Authorization: Bearer <jwt>  (JWT de vida corta)
  · El token ROTA: cada respuesta puede traer un token nuevo en un header;
    este cliente lo detecta automáticamente (busca cualquier header cuyo
    valor sea un JWT) y lo usa para la siguiente llamada.
  · Rate limit: ~500 req / ventana (header x-ratelimit-remaining).
"""
import argparse
import csv
import json
import os
import ssl
import sys
import time
import urllib.request
import urllib.parse
import urllib.error

BASE = "https://mapon.com/crm-api"

def _ssl_ctx():
    ca = os.environ.get("CA_BUNDLE") or os.environ.get("REQUESTS_CA_BUNDLE") \
        or os.environ.get("SSL_CERT_FILE")
    for cand in (ca, "/root/.ccr/ca-bundle.crt"):
        if cand and os.path.exists(cand):
            try:
                return ssl.create_default_context(cafile=cand)
            except Exception:
                pass
    return ssl.create_default_context()

class Mapon:
    def __init__(self, token):
        self.token = token
        self.ctx = _ssl_ctx()
        self.calls = 0

    def _adopt_rotated_token(self, headers):
        # El token rotado puede venir con cualquier nombre de header; lo
        # reconocemos porque su valor es un JWT (3 segmentos base64 'eyJ...').
        for k, v in headers.items():
            if not v:
                continue
            val = v.split("Bearer ")[-1].strip()
            if val.count(".") == 2 and val.startswith("eyJ") and val != self.token:
                self.token = val
                return True
        return False

    def get(self, path, params=None, tries=4):
        url = BASE + path
        if params:
            url += "?" + urllib.parse.urlencode(params, doseq=True)
        for attempt in range(tries):
            req = urllib.request.Request(url, headers={
                "Authorization": "Bearer " + self.token,
                "Accept": "application/json",
            })
            try:
                with urllib.request.urlopen(req, context=self.ctx, timeout=60) as resp:
                    self.calls += 1
                    self._adopt_rotated_token(dict(resp.headers))
                    remaining = resp.headers.get("x-ratelimit-remaining")
                    if remaining is not None and int(remaining) < 5:
                        time.sleep(2)
                    return json.loads(resp.read().decode("utf-8")), dict(resp.headers)
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "ignore")
                if e.code in (429, 500, 502, 503) and attempt < tries - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError(f"HTTP {e.code} en {path}: {body[:200]}")
            except urllib.error.URLError as e:
                if attempt < tries - 1:
                    time.sleep(2 ** attempt)
                    continue
                raise
        raise RuntimeError("sin respuesta")

    def paginate(self, path, params=None, limit=200):
        params = dict(params or {})
        params["limit"] = limit
        page = 1
        while True:
            params["page"] = page
            data, _ = self.get(path, params)
            items = data.get("data") or []
            if isinstance(items, dict):  # respuesta de error
                raise RuntimeError(f"{path}: {items}")
            for it in items:
                yield it
            meta = data.get("meta") or {}
            last = meta.get("last_page") or meta.get("lastPage")
            if not items or (last and page >= last) or len(items) < limit:
                break
            page += 1


def probe(api):
    data, headers = api.get("/account")
    print("== /account ==")
    print(json.dumps(data, indent=2, ensure_ascii=False)[:600])
    print("\n== headers de respuesta (para identificar rotación de token) ==")
    for k, v in headers.items():
        show = v if "token" not in k.lower() and not str(v).startswith("eyJ") else (str(v)[:18] + "…(JWT oculto)")
        print(f"  {k}: {show}")


CAR_FIELDS = ("id", "vinNumber", "companyId", "createDateTime", "lastDataReceived",
              "notes", "make", "model", "carNumber", "vehicleType", "registrationDate")

def dump(api, salida_dir):
    """Descarga TODO el CRM (empresas + vehículos con notas) a salida/_crm_raw/.
    Luego homologar.py lo consume con --crm. Se guarda incrementalmente."""
    raw = os.path.join(salida_dir, "_crm_raw")
    os.makedirs(raw, exist_ok=True)

    print("· Descargando empresas del CRM…")
    comps = list(api.paginate("/companies", {"extended": 1}))
    json.dump(comps, open(os.path.join(raw, "companies.json"), "w"), ensure_ascii=False)
    print(f"  empresas: {len(comps)}  (llamadas {api.calls})")

    print("· Descargando vehículos por empresa (notas + createDateTime)…")
    cars, errs = [], 0
    for i, c in enumerate(comps, 1):
        try:
            for car in api.paginate("/cars", {"companyId": c["id"], "extended": 1}):
                cars.append({k: car.get(k) for k in CAR_FIELDS})
        except Exception as e:
            errs += 1
            print(f"  ! empresa {c['id']}: {str(e)[:90]}")
        if i % 50 == 0:
            print(f"    {i}/{len(comps)} · {len(cars)} cars · {api.calls} llamadas")
            json.dump(cars, open(os.path.join(raw, "cars.json"), "w"), ensure_ascii=False)
    json.dump(cars, open(os.path.join(raw, "cars.json"), "w"), ensure_ascii=False)

    con_notas = sum(1 for c in cars if (c.get("notes") or "").strip())
    print(f"\n✓ {raw}/companies.json  ·  {raw}/cars.json")
    print(f"  vehículos: {len(cars)}  ·  con notas: {con_notas}  ·  errores: {errs}  ·  llamadas: {api.calls}")
    print("  Ahora corre:  python3 homologar.py   (toma el CRM automáticamente)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true", help="diagnostica 1 llamada y muestra headers")
    ap.add_argument("--salida", default=os.path.join(os.path.dirname(__file__), "salida"))
    args = ap.parse_args()

    token = os.environ.get("MAPON_TOKEN")
    if not token:
        sys.exit("Define MAPON_TOKEN con el JWT del CRM:  export MAPON_TOKEN='eyJ...'")
    api = Mapon(token)
    if args.probe:
        probe(api)
    else:
        dump(api, args.salida)


if __name__ == "__main__":
    main()
