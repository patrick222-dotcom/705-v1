# Provisional `schedule_rules` model, drafted from public nurse union contracts

Research date 2026-10-07. **Provisional** — drafted while Courtney's scheduling interview is outstanding; her unit's real values replace the defaults below, and Flow B's `schedule_rules` (see `agent-gateway-scope.md`, step 6) is designed from both. Every rule below was read in the contract text itself unless it is marked **unverified**.

## Sources (primary text read)

| Key | Contract | Region / union | URL |
|---|---|---|---|
| **UC** | University of California – CNA, unit NX. Art. 14 *Hours of Work*, Art. 18 *Holidays*. The search index lists these as the 2022–25 articles (**unverified** from the PDFs). The 2025–30 successor is ratified, but its articles are not posted yet | CA / CNA-NNU | https://ucnet.universityofcalifornia.edu/labor/bargaining-units/nx/docs/nx_14_hours_of_work.pdf · …/nx_18_holidays.pdf |
| **MN** | State of Minnesota – MNA, 2025–27. Art. 4 *Hours*, Art. 6 *Holidays*, Art. 17 §23. This covers **state facilities, not private Twin Cities hospitals**: I found no ratified Allina/Fairview/Children's contract online, only bargaining proposals | MN / MNA | https://mn.gov/mmb-stat/000/az/labor-relations/mna/contract/2025-2027/mna-contract.pdf |
| **UW** | UW Medical Center–Montlake – WSNA, 2025–27 tentative agreement (redlined) with the RCW summary. Art. 7, 12.3. The full 2023–25 PDF is truncated at 4 MB on the server and would not parse | WA / WSNA | https://hr.uw.edu/labor/wp-content/uploads/sites/8/2025/12/WSNA-ML-25-27-Combined-TA-w-Transparency-Bill.pdf |
| NYC (thin) | NYC Health+Hospitals – NYSNA staff nurses, 2019–23. Art. X *Work Schedules*. Appendix L is a 1997 shift-rotation memo, scanned with poor OCR, so it is partly legible only | NY / NYSNA | https://www.nyc.gov/assets/olr/downloads/pdf/collectivebargaining/staff-nurses%20-06-06-2019-03-02-2023.pdf |

No Oregon (ONA) or Massachusetts (MNA) contract text could be reached in this pass.

## (a) Rule types and how each contract sets them

| Rule | UC (CA) | MN state | UW (WA) | NYC |
|---|---|---|---|---|
| Schedule period | Not stated as a period. The patterns span 1–4 workweeks, e.g. "13 twelve-hour shifts in 4 workweeks" (14.B.2) | Pay period = 2 weeks / 80 h (4 §1) | **≥4 weeks** (7.4). The shift-rotation limit is per **28-day schedule** (7.6.2) | "work cycle", length not stated (X) |
| Posted ahead | **2 weeks** (14.C.1). Holiday schedules 4 weeks before Thanksgiving, Christmas and New Year (14.C.2) | **14 days**. Late posting pays 1.5× (4 §10) | **23 days**: the redline strikes "sixteen" and adds "twenty-three" (7.4). That reading of the redline is mine | ≥2 weeks, aim for 4 (X) |
| Request deadline | Not in Art. 14 | Part-time open-shift bids: preliminary schedule at **28 days**, picks added at **21 days**, by seniority (4 §7.A) | Unit-defined ("date all schedule requests are due", 7.6.1) | Not stated |
| Self-schedule / conflicts | Not in Art. 14 | Seniority for overtime and extra shifts (4 §6, §7) | Self- or pattern scheduling is encouraged. **Each unit's procedure resolves conflicts.** The manager approves (7.4.1) | Not stated |
| Weekend requirement | Try for **≥26 weekends off a year** (14.H) | "Every reasonable effort" at **every other weekend off** (4 §5.E) | Good-faith **2 of 4 weekends, max 4 weekend shifts** per schedule (≥0.5 FTE) (7.5) | Appendix J exists, but its text was not legible (**unverified**) |
| What counts as a weekend | Not defined | **Fri p.m. shift through Sun night**, for the bonus only (17 §23.4) | Days and evenings: **Sat + Sun**. Nights: **Fri night + Sat night**. 12h shifts count if most of the shift falls between **Fri 11pm and Sun 11pm** (7.5) | — |
| Night before a weekend off | — | **No night shift right before a weekend off** (4 §5.B) | — | — |
| Holidays | Each nurse gets **1 of 3 two-day major-holiday pairs** off: Thanksgiving + Fri, Dec 24–25, Dec 31–Jan 1 (18.C) | **Christmas alternates by odd/even year** (6 §9). Other holidays: seniority elects 45 days out (6 §6) | Peak-period vacation caps (Thanksgiving–Jan 1: 1 week). No rotation clause found in the TA (12.3.4) | — |
| Rest between shifts | **6 h**, or 1.5× pay (14.O) | **7.5 h**, or 1.5× (4 §5.G) | **11 h**, or a premium (7.9) | — |
| Shift changes / rotation | **48 h** between rotations. Nurses with ≥10 years are exempt (14.P) | Max **2 shifts per 3 pay periods** and **4 start times per pay period**, reasonable effort (4 §5.B–C) | Max **2 rotations per 28 days**, **15 h** apart (7.6.2) | Nurses with ≥7 years or regular evening/night nurses are exempt from rotation. Others: max 3 months a year (App. L, partly legible) |
| Max consecutive | 8h: **6**. 10h: **5**. 12h: **4**. Beyond that, 1.5×. Waivable (14.I) | **7 days**, normally 2 consecutive days off (4 §5.D) | Not found | — |
| Mandatory overtime | **None except a declared emergency**. Every reasonable effort to cap at **16 h** (14.M.1) | Inverse seniority. **Max 1 double per pay period** except emergencies. A patient-safety refusal is protected (4 §6) | Follows state law. Volunteers first. Doubles by mutual agreement only (7.3, 7.7) | — |
| On-call | Volunteers first, then distributed equitably (14.L) | Posted a month ahead where practicable. Not on a day off unless she accepts (4 §11) | Posted with the schedule (7.4) | — |
| Trades / pickups | — | Trades with supervisor approval. **Max 1 trade into a double per pay period** (4 §10). Part-timers get pickups first (4 §7) | Unit procedure (7.4.1). Classified staff get open shifts first (7.10). Pickups on an unscheduled weekend pay **2×** (7.5) | — |

Low census was not found as a rule in any of the four. **Unverified** whether it sits in another article.

## (b) Proposed JSON shape

Each rule is a small typed entry. A rule the checker cannot evaluate yet still carries `kind` so the nurse can see it.

```json
{
  "schedule_rules": {
    "version": 1,
    "source": { "label": "UW–WSNA 2025–27", "url": null, "confirmed_by_user": "2026-10-07" },
    "period": { "weeks": 4, "post_days_before": 23, "requests_due_days_before": null },
    "definitions": {
      "weekend": { "day_evening": ["sat","sun"], "night": ["fri","sat"],
                   "window": { "from": "fri 23:00", "to": "sun 23:00", "majority": true } }
    },
    "rules": [
      { "id": "weekends", "category": "weekend", "kind": "count",
        "num": { "max": 2, "per": "period" }, "unit": "weekends",
        "strength": "good_faith", "confidence": "contract", "cite": "7.5" },
      { "id": "weekend_shifts", "category": "weekend", "kind": "count",
        "num": { "max": 4, "per": "period" }, "unit": "shifts",
        "strength": "good_faith", "confidence": "contract", "cite": "7.5" },
      { "id": "rest", "category": "rest", "kind": "min_gap",
        "num": { "min": 11 }, "unit": "hours", "strength": "premium", "confidence": "contract", "cite": "7.9" },
      { "id": "consec", "category": "consecutive", "kind": "max_run",
        "num": { "max": 4 }, "unit": "shifts", "applies_to": { "shift_hours": 12 },
        "strength": "premium", "confidence": "default", "cite": null },
      { "id": "no_night_before_wkd_off", "category": "rotation", "kind": "forbid_sequence",
        "pattern": ["night", "weekend_off"], "strength": "hard", "confidence": "default" },
      { "id": "rotations", "category": "rotation", "kind": "count",
        "num": { "max": 2, "per": "period" }, "gap_hours": 15, "strength": "hard", "confidence": "contract" },
      { "id": "holidays", "category": "holiday", "kind": "rotation",
        "scheme": "pick_one_of", "groups": [["thanksgiving","thanksgiving+1"],["12-24","12-25"],["12-31","01-01"]],
        "strength": "guarantee", "confidence": "default" },
      { "id": "mandatory_ot", "category": "overtime", "kind": "cap",
        "num": { "max": 16 }, "unit": "consecutive_hours", "strength": "good_faith", "confidence": "default" }
    ]
  }
}
```

- `kind` is one of `count | min_gap | max_run | forbid_sequence | rotation | cap`. These six cover every row above.
- `num` is `{min?, max?, exact?, per?}` with `per` in `period | pay_period | week | year`.
- `strength` is `hard | guarantee | premium | good_faith`. **This field matters**: most limits in these contracts are not bans. They pay a premium when broken (UC and MN) or are "reasonable effort" goals. A checker should warn, not block, unless `strength` is `hard`.
- `confidence` is `contract` (cite filled in) | `user` (she typed it) | `default` (our guess, unconfirmed).

## (c) "Is this right?" card, 8 lines

The defaults are the most common value seen, or the strictest where the contracts split. Each line has a blank she can correct.

1. Your schedule covers **4** weeks. ____
2. It's posted **2** weeks before it starts, and requests are due **3** weeks before. ____
3. You work **every other** weekend (**2** of 4). ____
4. A weekend is **Sat + Sun** (nights: **Fri + Sat night**). ____
5. You need at least **11** hours between shifts. ____
6. At most **4** twelve-hour shifts in a row. ____
7. No night shift right before a weekend off: **yes**. ____
8. Holidays: you get **1 of** Thanksgiving / Christmas / New Year off. ____

## (d) Open questions where the contracts disagree

1. **Rest gap** ranges from 6 h (UC) to 7.5 h (MN) to 11 h (UW). There is no safe default; ask her.
2. **The weekend definition** differs by shift (UW), is unstated (UC), or is a Fri p.m.–Sun night window used only for a bonus (MN). The night-shift case decides whether Friday or Sunday night counts, and it changes the weekend count.
3. **Weekend frequency** is stated as a share (26 a year), as every other weekend, or as 2 of 4 with a shift cap. These are equivalent only on a 4-week period.
4. **Schedule period vs. pay period.** UW has a 4-week schedule. UC and MN tie limits to the 2-week pay period or workweek. The "6-week schedule" common in private hospitals was **not found** in any source here (**unverified**).
5. **Request deadline** is unit policy (UW) or absent (UC, NYC). Only MN's part-time bid (28/21 days) is in contract text. It probably has to come from her, not the contract.
6. **Holiday rotation** has three different schemes: pick 1 of 3 pairs (UC), Christmas alternating by year (MN), or seniority bidding (MN, other holidays).
7. **Mandatory overtime** is mostly set by state law (WA), not the contract. A per-state law layer may be needed. **Unverified** for each state.
8. **Self-scheduling conflict resolution** (seniority vs. rotation) is not in any contract read. It lives in unit guidelines (UW 7.4.1).
