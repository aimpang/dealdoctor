import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright


def post_preview(base_url: str, address: str) -> dict:
    req = urllib.request.Request(
        f"{base_url}/api/preview",
        data=json.dumps({"address": address}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return {
            "status": resp.status,
            "body": json.loads(resp.read().decode("utf-8")),
        }


def build_debug_query(debug_key: str | None) -> str:
    params = {"debug": "1"}
    if debug_key:
        params["debugKey"] = debug_key
    return urllib.parse.urlencode(params)


def get_report(base_url: str, uuid: str, debug_key: str | None) -> dict:
    query = build_debug_query(debug_key)
    with urllib.request.urlopen(f"{base_url}/api/report/{uuid}?{query}", timeout=120) as resp:
        return {
            "status": resp.status,
            "body": json.loads(resp.read().decode("utf-8")),
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a DealDoctor PDF from a live local report.")
    parser.add_argument("--address", required=True)
    parser.add_argument("--base-url", default="http://localhost:3000")
    parser.add_argument("--output", required=True)
    parser.add_argument("--debug-key")
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    preview = post_preview(args.base_url, args.address)
    print(json.dumps({
        "phase": "preview",
        "status": preview["status"],
        "uuid": preview["body"].get("uuid"),
        "error": preview["body"].get("error"),
    }))

    uuid = preview["body"].get("uuid")
    if not uuid:
        raise SystemExit(1)

    report = get_report(args.base_url, uuid, args.debug_key)
    full = json.loads(report["body"].get("fullReportData") or "null")
    if not full:
        raise RuntimeError(f"Report payload missing for {uuid}")

    query = build_debug_query(args.debug_key)
    report_url = f"{args.base_url}/report/{uuid}?{query}"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 2200})
        page.goto(report_url, wait_until="networkidle", timeout=120000)
        page.wait_for_selector("text=Export Excel", timeout=30000)
        page.pdf(
            path=str(output),
            format="Letter",
            print_background=True,
            margin={
                "top": "0.4in",
                "bottom": "0.4in",
                "left": "0.4in",
                "right": "0.4in",
            },
        )
        browser.close()

    print(json.dumps({
        "phase": "report",
        "uuid": uuid,
        "pdf": str(output),
        "status": report["status"],
        "qualityStatus": (full or {}).get("qualityAudit", {}).get("status"),
        "marketStatus": (full or {}).get("marketAudit", {}).get("status"),
    }))


if __name__ == "__main__":
    main()
