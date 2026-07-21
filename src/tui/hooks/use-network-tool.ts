import { useCallback, useState } from 'react';
import type { NetSortDir, NetSortKey, TypeFilter } from '../panels/NetworkPanel.js';
import type { NetGroupMode } from '../lib/net-group.js';
import type { TimeRange } from '../lib/timeline.js';
import { DEFAULT_NET_COLUMNS, loadConfig, normalizeNetColumns, saveConfig, type NetColumnId } from '../../config.js';

export function useNetworkTool() {
  const [netSel, setNetSel] = useState(0);
  const [netSelId, setNetSelId] = useState<string | null>(null);
  const [netFollow, setNetFollow] = useState(true);
  const [netSort, setNetSort] = useState<{ key: NetSortKey; dir: NetSortDir }>({ key: 'arrival', dir: 'asc' });
  const [netColumns, setNetColumns] = useState<NetColumnId[]>(() => loadConfig().networkColumns ?? DEFAULT_NET_COLUMNS);
  const [netPicker, setNetPicker] = useState<'type' | 'sort' | 'columns' | 'block' | 'copy' | null>(null);
  const [netGroup, setNetGroup] = useState<NetGroupMode>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [tlSelect, setTlSelect] = useState(false);
  const [tlCursor, setTlCursor] = useState(0);
  const [tlAnchor, setTlAnchor] = useState<number | null>(null);
  const [tlRange, setTlRange] = useState<(TimeRange & { label: string }) | null>(null);
  const [typeFilters, setTypeFilters] = useState<TypeFilter[]>([]);
  const [urlFilter, setUrlFilter] = useState('');
  const [filterEditing, setFilterEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [searchEditing, setSearchEditing] = useState(false);
  const [win, setWin] = useState(0);
  const [peek, setPeek] = useState(true);

  const applyTypeFilter = useCallback((values: string[]) => {
    setNetPicker(null);
    setTypeFilters(values.includes('all') ? [] : (values as TypeFilter[]));
    setNetSel(0);
    setNetSelId(null);
    setNetFollow(true);
  }, []);

  const applyColumns = useCallback((values: string[]) => {
    setNetPicker(null);
    const cols = normalizeNetColumns(values);
    setNetColumns(cols);
    saveConfig({ networkColumns: cols });
  }, []);

  return {
    netSel,
    setNetSel,
    netSelId,
    setNetSelId,
    netFollow,
    setNetFollow,
    netSort,
    setNetSort,
    netColumns,
    setNetColumns,
    netPicker,
    setNetPicker,
    netGroup,
    setNetGroup,
    collapsedGroups,
    setCollapsedGroups,
    marked,
    setMarked,
    tlSelect,
    setTlSelect,
    tlCursor,
    setTlCursor,
    tlAnchor,
    setTlAnchor,
    tlRange,
    setTlRange,
    typeFilters,
    setTypeFilters,
    urlFilter,
    setUrlFilter,
    filterEditing,
    setFilterEditing,
    searchQuery,
    setSearchQuery,
    searchDraft,
    setSearchDraft,
    searchEditing,
    setSearchEditing,
    win,
    setWin,
    peek,
    setPeek,
    applyTypeFilter,
    applyColumns,
  };
}

export type NetworkTool = ReturnType<typeof useNetworkTool>;
