"""fingerprint のゴールデンベクタを py-gn-log の Python 実装から生成する

正本は py-gn-log 側 (src/gnlog/fingerprint.py)。このスクリプトを py-gn-log の環境で実行し、
出力を test/fixtures/fingerprint-golden.json に書く (README の「fingerprint」の節を参照)。

    cd ../py-gn-log && uv run python ../ts-gn-log/test/fixtures/generate-fingerprint-golden.py \
        "$(git rev-parse --short HEAD)" > ../ts-gn-log/test/fixtures/fingerprint-golden.json
"""

import json
import sys

from gnlog.fingerprint import build_fingerprint, normalize_message

NORMALIZE_CASES = [
    "order 123 not found", "ratio 0.75 exceeded", 'user "alice" missing', "user 'bob' missing",
    "id 3f2504e0-4f89-11d3-9a0c-0305e82c3301 gone", "id 3F2504E0-4F89-11D3-9A0C-0305E82C3301 gone",
    'code "E123"', "table t1 locked", "no variable parts",
    "can't connect to database, won't retry", "user 'bob' can't login", "it's 'quoted'.",
    "user 'bob's account is locked", "count 1,234 rows", "count 9,876,543 rows",
    "timeout after 1.5e10 ns", "tolerance 2E-3 exceeded",
    "x" * 500, "a" * 298 + " 12345",
    # BMP 外の文字 (絵文字) を含む切り詰め — 単位はコードポイント (py-gn-log #26 の案 1)
    "x" * 100 + "😀" * 150, "x" * 299 + "😀" * 5, "日本語のメッセージ 12 件 'テスト'",
    "'cause it failed", "unbalanced 'quote here", "tab\tand\nnewline 'a\nb' end",
    "1e5 and 1,23 and 1.2.3 and 0x1F and v2", "a1 1a _1 1_ -1 +1 1-2",
]
# max_length を振った事例。負の値と 0 の扱いを両言語で突き合わせるための軸
# (Python のスライス s[:negative] は末尾から削る。非整数は Python では TypeError に
#  なるので契約の対象にせず、ts 側だけのテストで扱う)
NORMALIZE_MAX_LENGTH_CASES = [
    ("order 123 not found", -1),
    ("order 123 not found", -5),
    ("order 123 not found", 0),
    ("order 123 not found", 3),
    ("order 123 not found", 1000),
    # BMP 外の文字を含む負の切り詰め — 末尾から削る単位もコードポイント
    ("x" * 5 + "😀" * 5, -3),
    ("😀" * 5, -5),
    ("😀" * 5, -10),
    ("日本語のメッセージ 12 件", -4),
]
FINGERPRINT_CASES = [
    ("worker", "orders.create", "validation", "order 1 missing"),
    ("worker", "orders.create", "validation", "order 2 missing"),
    ("w", "op", "validation", "rejected 1,234 rows"),
    ("w", "op", "infra", "can't connect to database, won't retry"),
    ("worker|orders", "create", "validation", "boom"),
    ("worker", "orders|create", "validation", "boom"),
    ("worker|orders", "create", "validation", "a\\b"),
    ("", "orders.create", "validation", "surface empty"),
    ("worker", "orders.create", "validation",
     'order 123 for "alice" not found (id=3f2504e0-4f89-11d3-9a0c-0305e82c3301)'),
    ("日本", "注文.作成", "検証", "注文 123 が 'ユーザ' に見つかりません 😀"),
    ("w", "op", "t", "x" * 100 + "😀" * 150),
    ("w", "op", "t", "x" * 299 + "😀" * 5 + "|tail"),
]

commit = sys.argv[1] if len(sys.argv) > 1 else "unknown"
out = {
    "source": {
        "repo": "tengine/py-gn-log",
        "commit": commit,
        "generator": "test/fixtures/generate-fingerprint-golden.py (run with py-gn-log's uv environment)",
    },
    "truncation_unit": "code points (py-gn-log #26 案 1)",
    "max_message_length": 300,
    "normalize": [{"message": m, "expected": normalize_message(m)} for m in NORMALIZE_CASES],
    "normalize_max_length": [
        {"message": m, "max_length": n, "expected": normalize_message(m, n)}
        for m, n in NORMALIZE_MAX_LENGTH_CASES
    ],
    "fingerprint": [
        {"surface": s, "operation": o, "error_type": e, "message": m, "expected": build_fingerprint(s, o, e, m)}
        for s, o, e, m in FINGERPRINT_CASES
    ],
}
print(json.dumps(out, ensure_ascii=False, indent=2))
