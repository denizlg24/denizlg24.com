"""Fetch a deterministic real-label evaluation set from Open Food Facts.

Run deliberately, then review and commit both manifest.json and images/. The
runtime service never makes these network requests.
"""

import hashlib
import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE_URL = "https://world.openfoodfacts.net"
USER_AGENT = "MacrosVisionEval/0.1 (https://denizlg24.com)"
ROOT = Path(__file__).parent
FIELDS = "code,product_name,selected_images,nutriments,nutrition_data_per,countries_tags"
TARGET_PER_SERVING = 10
TARGET_TOTAL = 30


def request_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def product(code: str) -> dict | None:
    url = f"{BASE_URL}/api/v2/product/{code}?{urllib.parse.urlencode({'fields': FIELDS})}"
    body = request_json(url)
    value = body.get("product")
    return value if isinstance(value, dict) else None


def search_codes(**filters: str) -> list[str]:
    query = urllib.parse.urlencode({"page_size": 100, "fields": "code", **filters})
    search = request_json(f"{BASE_URL}/api/v2/search?{query}")
    return sorted(str(item["code"]) for item in search.get("products", []) if item.get("code"))


def nutrition_image(value: dict) -> tuple[str, str] | None:
    display = value.get("selected_images", {}).get("nutrition", {}).get("display", {})
    if not isinstance(display, dict) or not display:
        return None
    language = "en" if "en" in display else "pt" if "pt" in display else sorted(display)[0]
    # OFF's display URL is a 400 px derivative. RapidOCR should be evaluated
    # against the original label crop, which uses the stable `.full.jpg` URL.
    return language, re.sub(r"\.\d+\.jpg$", ".full.jpg", display[language])


def expected_fields(value: dict, suffix: str) -> dict[str, float]:
    nutrients = value.get("nutriments", {})
    mapping = {
        "calories": f"energy-kcal_{suffix}",
        "fat": f"fat_{suffix}",
        "saturated": f"saturated-fat_{suffix}",
        "carbs": f"carbohydrates_{suffix}",
        "sugar": f"sugars_{suffix}",
        "fiber": f"fiber_{suffix}",
        "protein": f"proteins_{suffix}",
        "salt": f"salt_{suffix}",
        "sodium": f"sodium_{suffix}",
    }
    return {
        field: float(nutrients[key])
        for field, key in mapping.items()
        if isinstance(nutrients.get(key), int | float)
    }


def main() -> None:
    serving_codes = search_codes(countries_tags_en="United States")
    global_codes = [code for code in search_codes() if code not in serving_codes]
    candidates = [(code, "serving") for code in serving_codes] + [
        (code, "100g") for code in global_codes
    ]
    with ThreadPoolExecutor(max_workers=6) as pool:
        products = list(pool.map(product, (code for code, _ in candidates)))

    images = ROOT / "images"
    images.mkdir(exist_ok=True)
    manifest = []
    serving_count = 0
    for value, (_, suffix) in zip(products, candidates, strict=True):
        if value is None or len(manifest) >= TARGET_TOTAL:
            continue
        if suffix == "serving" and serving_count >= TARGET_PER_SERVING:
            continue
        if suffix == "100g" and serving_count < TARGET_PER_SERVING:
            continue
        selected = nutrition_image(value)
        fields = expected_fields(value, suffix)
        basis = "per_serving" if suffix == "serving" else "per_100g"
        if not selected or not {"calories", "protein"}.issubset(fields):
            continue
        language, url = selected
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=30) as response:
            content = response.read()
        code = str(value["code"])
        image_suffix = Path(urllib.parse.urlparse(url).path).suffix or ".jpg"
        filename = f"{len(manifest) + 1:02d}-{code}{image_suffix}"
        (images / filename).write_bytes(content)
        manifest.append(
            {
                "file": f"images/{filename}",
                "barcode": code,
                "productName": value.get("product_name") or code,
                "language": language,
                "countries": value.get("countries_tags", []),
                "sourceUrl": url,
                "productUrl": f"https://world.openfoodfacts.org/product/{code}",
                "sha256": hashlib.sha256(content).hexdigest(),
                "expected": {"basis": basis, "fields": fields},
            }
        )
        serving_count += suffix == "serving"
    if len(manifest) != TARGET_TOTAL or serving_count != TARGET_PER_SERVING:
        raise RuntimeError(f"Found {len(manifest)} images but {serving_count} per-serving fixtures")
    referenced = {Path(item["file"]).name for item in manifest}
    for image in images.iterdir():
        if image.is_file() and image.name not in referenced:
            image.unlink()
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
