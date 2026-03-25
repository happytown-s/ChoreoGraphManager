import { useCallback } from 'react';
import { Dancer, Group, STAGE_WIDTH, STAGE_HEIGHT } from '../types';
import { HistoryAPI } from './useHistory';

export interface GroupDancerAPI {
  addNewDancer: () => void;
  removeDancer: (id: string, e?: React.MouseEvent) => void;
  updateDancer: (id: string, updates: Partial<Dancer>) => void;
  handleAddGroup: () => void;
  handleUpdateGroup: (updatedGroup: Group) => void;
  handleDeleteGroup: (groupId: string) => void;
  handleAssignDancerToGroup: (dancerId: string, groupId: string | undefined) => void;
  handleToggleSolo: (groupId: string) => void;
}

export function useGroupDancer(
  dancers: Dancer[],
  keyframes: any[],
  groups: Group[],
  history: HistoryAPI,
): GroupDancerAPI {

  const pushH = useCallback((
    newDancers: Dancer[],
    newGroups?: Group[],
    newKeyframes?: any[],
  ) => {
    history.pushState({
      dancers: newDancers,
      keyframes: newKeyframes ?? keyframes,
      groups: newGroups ?? groups,
    });
  }, [history, dancers, keyframes, groups]);

  const addNewDancer = useCallback(() => {
    const newId = `d${Date.now()}`;
    const newDancer: Dancer = {
      id: newId,
      name: `Dancer ${dancers.length + 1}`,
      color: '#' + Math.floor(Math.random() * 16777215).toString(16),
    };

    const newDancers = [...dancers, newDancer];
    const newKeyframes = keyframes.map((kf: any) => ({
      ...kf,
      positions: { ...kf.positions, [newId]: { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 } },
    }));

    pushH(newDancers, groups, newKeyframes);
  }, [dancers, keyframes, groups, pushH]);

  const removeDancer = useCallback((id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    const newDancers = dancers.filter(d => d.id !== id);
    const newKeyframes = keyframes.map((kf: any) => {
      const { [id]: _, ...rest } = kf.positions;
      return { ...kf, positions: rest };
    });

    pushH(newDancers, groups, newKeyframes);
  }, [dancers, keyframes, groups, pushH]);

  const updateDancer = useCallback((id: string, updates: Partial<Dancer>) => {
    const newDancers = dancers.map(d => d.id === id ? { ...d, ...updates } : d);
    pushH(newDancers);
  }, [dancers, pushH]);

  const handleAddGroup = useCallback(() => {
    const newGroup: Group = {
      id: `g${Date.now()}`,
      name: `Group ${groups.length + 1}`,
      color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
      isVisible: true,
      isSolo: false,
    };
    pushH(dancers, [...groups, newGroup]);
  }, [dancers, groups, pushH]);

  const handleUpdateGroup = useCallback((updatedGroup: Group) => {
    const newGroups = groups.map(g => g.id === updatedGroup.id ? updatedGroup : g);
    pushH(dancers, newGroups);
  }, [dancers, groups, pushH]);

  const handleDeleteGroup = useCallback((groupId: string) => {
    const newGroups = groups.filter(g => g.id !== groupId);
    const newDancers = dancers.map(d => d.groupId === groupId ? { ...d, groupId: undefined } : d);
    pushH(newDancers, newGroups);
  }, [dancers, groups, pushH]);

  const handleAssignDancerToGroup = useCallback((dancerId: string, groupId: string | undefined) => {
    const newDancers = dancers.map(d => d.id === dancerId ? { ...d, groupId } : d);
    pushH(newDancers);
  }, [dancers, pushH]);

  const handleToggleSolo = useCallback((groupId: string) => {
    const targetGroup = groups.find(g => g.id === groupId);
    if (!targetGroup) return;

    const isCurrentlySolo = targetGroup.isSolo;
    const newGroups = groups.map(g => ({
      ...g,
      isSolo: g.id === groupId ? !isCurrentlySolo : false,
    }));
    pushH(dancers, newGroups);
  }, [dancers, groups, pushH]);

  return {
    addNewDancer,
    removeDancer,
    updateDancer,
    handleAddGroup,
    handleUpdateGroup,
    handleDeleteGroup,
    handleAssignDancerToGroup,
    handleToggleSolo,
  };
}
