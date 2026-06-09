import React from 'react';
import type { CategoryGroupAPI } from '../api';

interface CategorySelectProps {
  value: string;
  onChange: (id: string | null) => void;
  rawCategoryGroups: CategoryGroupAPI[];
  style?: React.CSSProperties;
  placeholder?: string;
}

export function CategorySelect({ value, onChange, rawCategoryGroups, style, placeholder = '—' }: CategorySelectProps) {
  const systemGroups = rawCategoryGroups.filter(g => g.is_system && !g.hidden);
  const regularGroups = rawCategoryGroups.filter(g => !g.is_system && !g.hidden);

  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value || null)}
      style={style}
    >
      <option value="">{placeholder}</option>
      {systemGroups.map(g => (
        <optgroup key={g.id} label={`━━ ${g.name.toUpperCase()} ━━`}>
          {g.categories.filter(c => !c.hidden).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </optgroup>
      ))}
      {regularGroups.map(g => (
        <optgroup key={g.id} label={g.name}>
          {g.categories.filter(c => !c.hidden).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
