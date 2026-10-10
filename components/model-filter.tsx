'use client';

import { MultiSelect } from '@/components/multi-select';
import { shortenModel } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';
import { splitModelRoute } from '@/lib/providers/codex/model-route.js';

function renderModel(id: string): string {
  const { model, route } = splitModelRoute(id);
  return route ? `${shortenModel(model)} · ${route}` : shortenModel(model);
}

export function ModelFilter({ all, selected }: { all: string[]; selected: string[] }) {
  const t = useT();
  return (
    <MultiSelect
      paramKey="models"
      all={all}
      selected={selected}
      render={renderModel}
      labelAllKey="filter.modelAll"
      labelSingleKey="filter.modelSingle"
      labelMultiKey="filter.modelMulti"
      ariaLabel={t('filter.modelLabel')}
    />
  );
}
