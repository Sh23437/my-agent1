#!/usr/bin/env python3
"""Fill the delivery questionnaire template for one recipient.

Usage:
  python3 make_questionnaire.py --name "Anna Weber" --ref "Order 4471" \
      --reply-to shofer943@gmail.com --out /path/to/questionnaire.html

Values are written as JSON inside the page (with "<" escaped) and as an
HTML-escaped <title>, so names with quotes or angle brackets are safe.
"""
import argparse
import datetime
import html
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
TEMPLATE = HERE.parent / "assets" / "questionnaire.html"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--name", required=True, help="Recipient's name as shown on the page")
    p.add_argument("--ref", default="", help="Delivery or order reference (optional)")
    p.add_argument("--reply-to", required=True, help="Email address the answers go back to")
    p.add_argument("--sender", default="", help="Who the questionnaire is from (optional footer)")
    p.add_argument("--date", default=datetime.date.today().isoformat(), help="Date shown as 'Sent'")
    p.add_argument("--out", required=True, help="Where to write the filled HTML")
    a = p.parse_args()

    tpl = TEMPLATE.read_text(encoding="utf-8")
    cfg = {
        "recipientName": a.name.strip(),
        "deliveryRef": a.ref.strip(),
        "replyTo": a.reply_to.strip(),
        "senderLabel": a.sender.strip(),
        "sentDate": a.date.strip(),
    }
    cfg_json = json.dumps(cfg, ensure_ascii=False).replace("<", "\\u003c")
    first = cfg["recipientName"].split()[0] if cfg["recipientName"] else ""
    title = f"Delivery Feedback {first}".strip()

    for ph in ("__TITLE__", "__CONFIG_JSON__"):
        if tpl.count(ph) != 1:
            print(f"template placeholder {ph} missing or repeated", file=sys.stderr)
            return 1
    out = tpl.replace("__TITLE__", html.escape(title)).replace("__CONFIG_JSON__", cfg_json)
    pathlib.Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(a.out).write_text(out, encoding="utf-8")
    print(a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
