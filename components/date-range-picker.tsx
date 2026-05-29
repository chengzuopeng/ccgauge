'use client';

import { DayPicker, type DateRange } from 'react-day-picker';
import { enUS, zhCN } from 'react-day-picker/locale';
import { useI18n } from '@/lib/i18n/context';

interface Props {

  selected?: DateRange;

  onSelect?: (range: DateRange | undefined) => void;

  toDate?: Date;
}

export function DateRangePicker({ selected, onSelect, toDate }: Props) {
  const { locale } = useI18n();
  const dfLocale = locale === 'zh' ? zhCN : enUS;

  const cap = toDate ?? new Date();

  return (
    <DayPicker
      mode="range"
      locale={dfLocale}
      selected={selected}
      onSelect={onSelect}

      endMonth={cap}

      disabled={{ after: cap }}

      numberOfMonths={1}
    />
  );
}
