"""Reference vectors for `src/rrule.ts` (T084, EV-FR-17), expanded by python-dateutil.

Regenerate (the output is committed; tests never run this):

    python3 -m venv /tmp/rrvenv && /tmp/rrvenv/bin/pip install python-dateutil==2.9.0.post0
    /tmp/rrvenv/bin/python packages/shared/tests/fixtures/rrule/generate.py > packages/shared/tests/fixtures/rrule/vectors.json

Each case is a rule in the subset `rrule.ts` accepts, a DTSTART as local wall-clock time in an IANA
zone and a window. The expansion is dateutil's `rrule` over a timezone-aware DTSTART (Python adds
`timedelta`s on wall-clock time, so local times survive DST changes); UTC instants come from
`zoneinfo` with fold=0 (a repeated time takes its first instant, a skipped one the offset in force
before the change, as `zonedToUtc` does). Only the rule text is mapped to dateutil arguments here,
by hand: `EXDATE=` (this subset's extension, local dates) removes those days after COUNT, as an
RFC 5545 EXDATE does, and a date-only UNTIL means the end of that local day.
"""

import json
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import dateutil
from dateutil import rrule as du

FREQ = {"DAILY": du.DAILY, "WEEKLY": du.WEEKLY, "MONTHLY": du.MONTHLY}
DAYS = {"MO": du.MO, "TU": du.TU, "WE": du.WE, "TH": du.TH, "FR": du.FR, "SA": du.SA, "SU": du.SU}

CASES = [
    # rule, local DTSTART, zone, window from (local), window to (local)
    ("FREQ=DAILY;COUNT=10", "2026-01-05T09:00", "UTC", None, None),
    ("FREQ=DAILY;INTERVAL=3;COUNT=8", "2026-02-25T18:00", "UTC", None, None),
    ("FREQ=DAILY;UNTIL=20260310", "2026-03-01T07:15", "UTC", None, None),
    ("FREQ=DAILY;BYDAY=MO,WE,FR;COUNT=12", "2026-04-01T12:00", "UTC", None, None),
    ("FREQ=DAILY;BYMONTHDAY=1,15,-1;COUNT=9", "2026-01-10T10:00", "UTC", None, None),
    ("FREQ=WEEKLY;COUNT=6", "2026-06-02T19:30", "UTC", None, None),
    ("FREQ=WEEKLY;BYDAY=MO,TH;COUNT=10", "2026-06-03T19:30", "UTC", None, None),
    ("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,SA;COUNT=9", "2026-07-01T08:00", "UTC", None, None),
    ("FREQ=WEEKLY;BYDAY=SU;UNTIL=20261227T000000Z", "2026-11-01T10:00", "UTC", None, None),
    ("FREQ=MONTHLY;COUNT=8", "2026-01-31T20:00", "UTC", None, None),
    ("FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=6", "2026-01-15T20:00", "UTC", None, None),
    ("FREQ=MONTHLY;BYMONTHDAY=30;COUNT=6", "2026-01-30T09:00", "UTC", None, None),
    ("FREQ=MONTHLY;BYDAY=1MO;COUNT=6", "2026-01-01T18:00", "UTC", None, None),
    ("FREQ=MONTHLY;BYDAY=-1FR;COUNT=6", "2026-01-01T18:00", "UTC", None, None),
    ("FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU,4TU;COUNT=8", "2026-01-01T19:00", "UTC", None, None),
    ("FREQ=MONTHLY;BYDAY=SA,SU;BYMONTHDAY=1,2,3,4,5,6,7;COUNT=6", "2026-01-01T11:00", "UTC", None, None),
    ("FREQ=MONTHLY;INTERVAL=3;UNTIL=20271231", "2026-02-28T12:00", "UTC", None, None),
    ("FREQ=WEEKLY;BYDAY=MO;COUNT=8;EXDATE=20260615,20260629", "2026-06-01T19:00", "UTC", None, None),
    ("FREQ=DAILY;EXDATE=20261225,20261226;UNTIL=20261231", "2026-12-20T17:00", "UTC", None, None),
    # Daylight saving: local times stay put, UTC instants move.
    ("FREQ=WEEKLY;COUNT=6", "2026-03-15T19:30", "Europe/London", None, None),
    ("FREQ=WEEKLY;BYDAY=TU,TH;COUNT=8", "2026-10-13T19:30", "Europe/London", None, None),
    ("FREQ=DAILY;COUNT=4", "2026-03-28T01:30", "Europe/London", None, None),  # 01:30 is skipped on the 29th
    ("FREQ=DAILY;COUNT=4", "2026-10-24T01:30", "Europe/London", None, None),  # 01:30 is repeated on the 25th
    ("FREQ=MONTHLY;BYDAY=2SU;COUNT=6", "2026-01-01T10:00", "America/New_York", None, None),
    ("FREQ=WEEKLY;BYDAY=FR;UNTIL=20261231T235959Z", "2026-09-04T18:00", "Australia/Sydney", None, None),
    # Windows: a slice of a long series, with and without COUNT.
    ("FREQ=DAILY", "2025-01-01T09:00", "Europe/London", "2026-03-27T00:00", "2026-04-02T23:59"),
    ("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE", "2024-05-01T19:00", "Europe/Paris", "2026-10-01T00:00", "2026-11-30T23:59"),
    ("FREQ=MONTHLY;BYMONTHDAY=15", "2023-01-15T12:00", "UTC", "2026-01-01T00:00", "2026-06-30T23:59"),
    ("FREQ=DAILY;COUNT=400", "2026-01-01T08:00", "UTC", "2026-12-25T00:00", "2027-01-10T00:00"),
]


def rule_of(text, start, zone):
    kw = {"dtstart": start}
    skip = set()
    for part in text.split(";"):
        k, v = part.split("=")
        if k == "FREQ":
            freq = FREQ[v]
        elif k == "INTERVAL":
            kw["interval"] = int(v)
        elif k == "COUNT":
            kw["count"] = int(v)
        elif k == "BYMONTHDAY":
            kw["bymonthday"] = [int(d) for d in v.split(",")]
        elif k == "BYDAY":
            days = []
            for d in v.split(","):
                n, w = d[:-2], DAYS[d[-2:]]
                days.append(w(int(n)) if n else w)
            kw["byweekday"] = days
        elif k == "UNTIL":
            if len(v) == 8:
                kw["until"] = datetime(int(v[:4]), int(v[4:6]), int(v[6:8]), 23, 59, 59, tzinfo=zone)
            else:
                kw["until"] = datetime.strptime(v, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        elif k == "EXDATE":
            skip = set(v.split(","))
        else:
            raise ValueError(k)
    return du.rrule(freq, **kw), skip


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def main():
    vectors = []
    for text, local, zone_name, frm, to in CASES:
        zone = ZoneInfo(zone_name)
        start = datetime.fromisoformat(local).replace(tzinfo=zone)
        rule, skip = rule_of(text, start, zone)
        lo = datetime.fromisoformat(frm).replace(tzinfo=zone) if frm else start
        hi = datetime.fromisoformat(to).replace(tzinfo=zone) if to else start + timedelta(days=800)
        out = [
            iso(t)
            for t in rule.between(start - timedelta(seconds=1), hi, inc=True)
            if t.strftime("%Y%m%d") not in skip and lo <= t <= hi
        ]
        vectors.append(
            {"rule": text, "start": iso(start), "zone": zone_name, "from": iso(lo), "to": iso(hi), "expected": out}
        )
    json.dump({"generator": f"python-dateutil {dateutil.__version__}", "vectors": vectors}, sys.stdout, indent=1)
    sys.stdout.write("\n")


main()
