"""Datas no fuso de quem usa. Porta de `agent/lib/dates.ts`."""

from __future__ import annotations

import calendar
from datetime import date, datetime
from zoneinfo import ZoneInfo

TIMEZONE = "America/Sao_Paulo"


def today_in_sao_paulo(now: datetime | None = None) -> str:
    """Data de hoje em São Paulo, YYYY-MM-DD."""
    moment = now or datetime.now(tz=ZoneInfo("UTC"))
    return moment.astimezone(ZoneInfo(TIMEZONE)).strftime("%Y-%m-%d")


def month_range(month: str) -> tuple[str, str]:
    """Um mês do calendário como intervalo de datas inclusivo (`from`, `to`)."""
    year, month_number = (int(part) for part in month.split("-"))
    last_day = calendar.monthrange(year, month_number)[1]
    return f"{month}-01", f"{month}-{last_day:02d}"


def days_until(from_date: str, to_date: str) -> int:
    """Dias de `from_date` até `to_date`. Negativo quando `to_date` já passou."""
    a = date.fromisoformat(from_date)
    b = date.fromisoformat(to_date)
    return (b - a).days


def next_occurrence(after: str, day_of_month: int) -> str:
    """Próxima ocorrência de um dia do mês, a partir de `after`.

    Meses curtos são tratados por ancoragem no último dia: um compromisso de
    dia 31 cai em 28 ou 29 de fevereiro, sem transbordar para março.
    """
    year, month = (int(part) for part in after.split("-")[:2])
    current_day = int(after[8:10])

    target_year, target_month = year, month
    if current_day >= day_of_month:
        target_month += 1
        if target_month > 12:
            target_month = 1
            target_year += 1

    last_day = calendar.monthrange(target_year, target_month)[1]
    day = min(day_of_month, last_day)
    return f"{target_year}-{target_month:02d}-{day:02d}"
