import { useState, useRef, type FC, type ReactNode, type PointerEvent, type DragEvent } from 'react';
import { Dancer, Group } from '../types';
import {
    Plus, Trash2, Eye, EyeOff, Edit2, Check, X,
    Users, User, ChevronDown, ChevronUp, Move
} from 'lucide-react';

interface GroupListProps {
    groups: Group[];
    dancers: Dancer[];
    onAddGroup: () => void;
    onUpdateGroup: (group: Group) => void;
    onDeleteGroup: (groupId: string) => void;
    onAssignDancerToGroup: (dancerId: string, groupId: string | undefined) => void;
    onToggleSolo: (groupId: string) => void;
    onAddDancer: () => void;
    onDeleteDancer: (dancerId: string) => void;
    onUpdateDancer: (id: string, updates: Partial<Dancer>) => void;
}

// モバイル対応のボタンコンポーネント
const TouchButton: FC<{
    onClick: () => void;
    className?: string;
    title?: string;
    children: ReactNode;
    variant?: 'default' | 'primary' | 'danger';
}> = ({ onClick, className = '', title, children, variant = 'default' }) => {
    const handlePointerUp = (e: PointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    };

    const baseClasses = 'select-none touch-none';
    const variantClasses = {
        default: '',
        primary: 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700',
        danger: 'bg-red-600 hover:bg-red-500 active:bg-red-700'
    };

    return (
        <button
            onPointerUp={handlePointerUp}
            className={`${baseClasses} ${variantClasses[variant]} ${className}`}
            title={title}
            type="button"
        >
            {children}
        </button>
    );
};

export const GroupList: FC<GroupListProps> = ({
    groups,
    dancers,
    onAddGroup,
    onUpdateGroup,
    onDeleteGroup,
    onAssignDancerToGroup,
    onToggleSolo,
    onAddDancer,
    onDeleteDancer,
    onUpdateDancer,
}) => {
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
    const [editingDancerId, setEditingDancerId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(groups.map(g => g.id)));
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [assigningDancerId, setAssigningDancerId] = useState<string | null>(null);
    const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
    const [colorPickerDancerId, setColorPickerDancerId] = useState<string | null>(null);
    const [colorPickerAnchor, setColorPickerAnchor] = useState<{ top: number; left: number } | null>(null);

    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const handleStartEdit = (group: Group) => {
        setEditingGroupId(group.id);
        setEditName(group.name);
    };

    const handleSaveEdit = () => {
        if (editingGroupId) {
            const group = groups.find(g => g.id === editingGroupId);
            if (group) {
                onUpdateGroup({ ...group, name: editName });
            }
            setEditingGroupId(null);
        }
    };

    const handleCancelEdit = () => {
        setEditingGroupId(null);
    };

    // --- Dancer name edit ---
    const handleStartDancerEdit = (dancer: Dancer, e?: PointerEvent<HTMLDivElement>) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        setEditingDancerId(dancer.id);
        setEditName(dancer.name);
    };

    const handleSaveDancerEdit = () => {
        if (editingDancerId && editName.trim()) {
            onUpdateDancer(editingDancerId, { name: editName.trim() });
        }
        setEditingDancerId(null);
    };

    const handleCancelDancerEdit = () => {
        setEditingDancerId(null);
    };

    // --- Dancer color picker ---
    const handleColorPickerOpen = (dancerId: string, e: PointerEvent<HTMLSpanElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        setColorPickerAnchor({ top: rect.bottom + 4, left: rect.left });
        setColorPickerDancerId(dancerId);
    };

    const handleColorChange = (color: string) => {
        if (colorPickerDancerId) {
            onUpdateDancer(colorPickerDancerId, { color });
        }
    };

    const toggleGroupExpand = (groupId: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    };

    const handleDeleteClick = (groupId: string) => {
        if (deleteConfirmId === groupId) {
            onDeleteGroup(groupId);
            setDeleteConfirmId(null);
        } else {
            setDeleteConfirmId(groupId);
            setTimeout(() => setDeleteConfirmId(null), 3000);
        }
    };

    const handleAssignDancer = (dancerId: string, groupId: string | undefined) => {
        onAssignDancerToGroup(dancerId, groupId);
        setAssigningDancerId(null);
        setDropdownPosition(null);
    };

    const handleDancerClick = (dancerId: string, event: PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();

        if (assigningDancerId === dancerId) {
            setAssigningDancerId(null);
            setDropdownPosition(null);
        } else {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            setDropdownPosition({
                top: rect.bottom + 4,
                left: rect.left
            });
            setAssigningDancerId(dancerId);
        }
    };

    const ungroupedDancers = dancers.filter(d => !d.groupId);

    const handleDragStart = (e: DragEvent<HTMLDivElement>, dancerId: string) => {
        e.dataTransfer.setData('dancerId', dancerId);
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>, targetGroupId: string | undefined) => {
        e.preventDefault();
        const dancerId = e.dataTransfer.getData('dancerId');
        if (dancerId) {
            const dancer = dancers.find(d => d.id === dancerId);
            if (dancer && dancer.groupId !== targetGroupId) {
                onAssignDancerToGroup(dancerId, targetGroupId);
            }
        }
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
    };

    // Reusable dancer chip with name editing + color picker
    const DancerChip: FC<{ dancer: Dancer; inGroup?: boolean; visible?: boolean }> = ({ dancer, inGroup, visible = true }) => {
        const isEditing = editingDancerId === dancer.id;

        if (isEditing) {
            return (
                <div className="flex items-center gap-1 bg-slate-600 px-2 py-1 rounded-lg min-h-[44px] sm:min-h-0">
                    <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveDancerEdit();
                            if (e.key === 'Escape') handleCancelDancerEdit();
                            e.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-slate-900 text-white text-sm px-2 py-1 rounded border border-slate-600 w-full focus:outline-none focus:border-blue-500 min-h-[44px] sm:min-h-0"
                        autoFocus
                    />
                    <TouchButton
                        onClick={() => handleSaveDancerEdit()}
                        className="text-green-500 hover:text-green-400 p-2 sm:p-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
                    >
                        <Check size={16} />
                    </TouchButton>
                    <TouchButton
                        onClick={() => handleCancelDancerEdit()}
                        className="text-slate-500 hover:text-slate-400 p-2 sm:p-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
                    >
                        <X size={16} />
                    </TouchButton>
                </div>
            );
        }

        return (
            <div className="relative group/dancer">
                <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, dancer.id)}
                    onPointerUp={(e) => handleDancerClick(dancer.id, e)}
                    className={`px-3 py-2 sm:px-2 sm:py-1 rounded-lg text-sm sm:text-xs cursor-pointer border flex items-center gap-2 sm:gap-1 min-h-[44px] sm:min-h-0 select-none ${inGroup
                        ? 'bg-slate-700/50 text-slate-300 border-transparent hover:border-slate-500 hover:bg-slate-600 active:bg-slate-500'
                        : 'bg-slate-700 text-slate-200 border-transparent hover:border-slate-500 hover:bg-slate-600 active:bg-slate-500'
                        }`}
                    style={{ opacity: visible ? 1 : 0.5 }}
                    title={`${dancer.name} - Tap to ${inGroup ? 'reassign' : 'assign'}`}
                >
                    {/* Color circle - tap to open color picker */}
                    <span
                        className="w-4 h-4 sm:w-3 sm:h-3 rounded-full inline-block flex-shrink-0 cursor-pointer border border-slate-500 hover:border-white transition-colors"
                        style={{ backgroundColor: dancer.color }}
                        onPointerUp={(e) => handleColorPickerOpen(dancer.id, e)}
                        title="Change color"
                    />
                    {/* Dancer name - tap to rename (mobile) / show edit button on hover (desktop) */}
                    <div className="flex items-center gap-1 flex-1 min-w-0 group/name">
                        <span
                            className="truncate cursor-pointer min-h-[44px] sm:min-h-0 flex items-center sm:cursor-default"
                            onClick={() => handleStartDancerEdit(dancer)}
                        >
                            {dancer.name}
                        </span>
                        {/* Edit button - desktop only, shown on hover */}
                        <TouchButton
                            onClick={() => handleStartDancerEdit(dancer)}
                            className="opacity-0 group-hover/name:opacity-100 text-slate-400 hover:text-slate-200 transition-opacity p-1 hidden sm:flex min-h-0 min-w-0"
                        >
                            <Edit2 size={12} />
                        </TouchButton>
                    </div>
                    {!inGroup && (
                        <Move size={12} className="hidden sm:block text-slate-500 ml-1" />
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-slate-900 border-l border-slate-700 md:w-64 w-full">
            {/* Header */}
            <div className="p-3 sm:p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800 sticky top-0 z-[100]">
                <h3 className="font-bold text-slate-200 flex items-center gap-2 text-sm sm:text-base">
                    <Users size={18} />
                    <span className="hidden xs:inline">Groups</span>
                    <span className="text-slate-500 text-xs">({groups.length})</span>
                </h3>
                <TouchButton
                    onClick={onAddGroup}
                    className="p-2 sm:p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 active:bg-slate-600 bg-slate-700/50 sm:bg-transparent min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
                    title="Add Group"
                >
                    <Plus size={20} className="sm:w-[18px] sm:h-[18px]" />
                </TouchButton>
            </div>

            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-2 space-y-2 sm:space-y-3">
                {/* Ungrouped Dancers Area */}
                <div
                    onDrop={(e) => handleDrop(e, undefined)}
                    onDragOver={handleDragOver}
                    className="bg-slate-800/50 rounded-lg p-2 sm:p-2 border border-dashed border-slate-700 min-h-[80px] sm:min-h-[60px]"
                >
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ungrouped</h4>
                        <TouchButton
                            onClick={onAddDancer}
                            className="p-2 sm:p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
                            title="Add Dancer"
                        >
                            <Plus size={18} />
                        </TouchButton>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {ungroupedDancers.map(dancer => (
                            <DancerChip key={dancer.id} dancer={dancer} />
                        ))}
                        {ungroupedDancers.length === 0 && (
                            <span className="text-xs text-slate-600 italic py-2">No dancers</span>
                        )}
                    </div>
                </div>

                {/* Groups */}
                {groups.map(group => {
                    const groupDancers = dancers.filter(d => d.groupId === group.id);
                    const isEditing = editingGroupId === group.id;
                    const isExpanded = expandedGroups.has(group.id);
                    const isDeleteConfirm = deleteConfirmId === group.id;

                    return (
                        <div
                            key={group.id}
                            onDrop={(e) => handleDrop(e, group.id)}
                            onDragOver={handleDragOver}
                            className={`bg-slate-800 rounded-lg border ${group.isSolo ? 'border-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.1)]' : 'border-slate-700'} overflow-hidden transition-all`}
                        >
                            {/* Header */}
                            <div className="p-2 sm:p-2 flex items-center justify-between bg-slate-800/80">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    {/* Expand/Collapse Button */}
                                    <TouchButton
                                        onClick={() => toggleGroupExpand(group.id)}
                                        className="p-2 sm:p-1 rounded hover:bg-slate-700 text-slate-400 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
                                    >
                                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                    </TouchButton>

                                    {/* Solo Button */}
                                    <TouchButton
                                        onClick={() => onToggleSolo(group.id)}
                                        className={`p-2 sm:p-1 rounded min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center ${group.isSolo ? 'bg-yellow-500/20 text-yellow-500' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700'}`}
                                        title={group.isSolo ? "Solo Mode Active" : "Enable Solo Mode"}
                                    >
                                        <User size={16} />
                                    </TouchButton>

                                    {isEditing ? (
                                        <div className="flex items-center gap-1 flex-1">
                                            <input
                                                type="text"
                                                value={editName}
                                                onChange={(e) => setEditName(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleSaveEdit();
                                                    if (e.key === 'Escape') handleCancelEdit();
                                                }}
                                                className="bg-slate-900 text-white text-sm px-2 py-1.5 rounded border border-slate-600 w-full focus:outline-none focus:border-blue-500 min-h-[44px] sm:min-h-0"
                                                autoFocus
                                            />
                                            <TouchButton
                                                onClick={handleSaveEdit}
                                                className="text-green-500 hover:text-green-400 p-2 sm:p-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
                                            >
                                                <Check size={16} />
                                            </TouchButton>
                                            <TouchButton
                                                onClick={handleCancelEdit}
                                                className="text-slate-500 hover:text-slate-400 p-2 sm:p-0 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
                                            >
                                                <X size={16} />
                                            </TouchButton>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 flex-1 min-w-0 group/title">
                                            <span
                                                className="w-3 h-3 sm:w-2 sm:h-2 rounded-full flex-shrink-0"
                                                style={{ backgroundColor: group.color }}
                                            />
                                            {/* Group name - tap to rename on mobile */}
                                            <span
                                                className={`text-sm font-medium ${group.isVisible ? 'text-slate-200' : 'text-slate-500'} whitespace-nowrap cursor-pointer min-h-[44px] sm:min-h-0 flex items-center sm:cursor-default`}
                                                onClick={() => handleStartEdit(group)}
                                                title="Tap to rename"
                                            >
                                                {group.name}
                                            </span>
                                            <span className="text-xs text-slate-600 hidden sm:inline shrink-0">
                                                ({groupDancers.length})
                                            </span>
                                            {/* Edit button - desktop only, shown on hover */}
                                            <TouchButton
                                                onClick={() => handleStartEdit(group)}
                                                className="opacity-0 group-hover/title:opacity-100 text-slate-500 hover:text-slate-300 transition-opacity p-1 hidden sm:flex min-h-0 min-w-0"
                                            >
                                                <Edit2 size={12} />
                                            </TouchButton>
                                        </div>
                                    )}
                                </div>

                                {/* Action Buttons */}
                                {!isEditing && (
                                    <div className="flex items-center gap-1">
                                        <TouchButton
                                            onClick={() => onUpdateGroup({ ...group, isVisible: !group.isVisible })}
                                            className={`p-2 sm:p-1 rounded hover:bg-slate-700 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center ${group.isVisible ? 'text-slate-400' : 'text-slate-600'}`}
                                            title={group.isVisible ? "Hide Group" : "Show Group"}
                                        >
                                            {group.isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                                        </TouchButton>
                                        <TouchButton
                                            onClick={() => handleDeleteClick(group.id)}
                                            className={`p-2 sm:p-1 rounded min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center transition-colors ${isDeleteConfirm
                                                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                                : 'hover:bg-slate-700 text-slate-500 hover:text-red-400'
                                                }`}
                                            title={isDeleteConfirm ? "Tap again to confirm" : "Delete Group"}
                                        >
                                            <Trash2 size={16} />
                                        </TouchButton>
                                    </div>
                                )}
                            </div>

                            {/* Dancers List - Collapsible */}
                            {isExpanded && (
                                <div className="p-2 pt-0 flex flex-wrap gap-2 border-t border-slate-700/50 mt-2 pt-2">
                                    {groupDancers.map(dancer => (
                                        <DancerChip key={dancer.id} dancer={dancer} inGroup visible={group.isVisible} />
                                    ))}
                                    {groupDancers.length === 0 && (
                                        <div className="w-full text-center py-3 sm:py-2 text-xs text-slate-600 border border-dashed border-slate-700/50 rounded">
                                            Drop dancers here
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Empty State */}
                {groups.length === 0 && (
                    <div className="text-center py-8 text-slate-500">
                        <Users size={32} className="mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No groups yet</p>
                        <TouchButton
                            onClick={onAddGroup}
                            className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-lg text-white text-sm min-h-[44px]"
                            variant="primary"
                        >
                            Create First Group
                        </TouchButton>
                    </div>
                )}
            </div>

            {/* Fixed Dropdown - rendered at root level to avoid clipping */}
            {assigningDancerId && dropdownPosition && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onPointerUp={() => {
                            setAssigningDancerId(null);
                            setDropdownPosition(null);
                        }}
                    />
                    <div
                        className="fixed bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 overflow-hidden min-w-[150px]"
                        style={{
                            top: dropdownPosition.top,
                            left: dropdownPosition.left,
                        }}
                    >
                        <div className="text-xs text-slate-500 px-3 py-2 border-b border-slate-700">
                            {dancers.find(d => d.id === assigningDancerId)?.groupId ? 'Move to:' : 'Assign to group:'}
                        </div>
                        {dancers.find(d => d.id === assigningDancerId)?.groupId && (
                            <TouchButton
                                onClick={() => handleAssignDancer(assigningDancerId, undefined)}
                                className="w-full text-left px-3 py-2.5 sm:py-2 text-sm text-slate-300 hover:bg-slate-700 active:bg-slate-600 flex items-center gap-2 min-h-[44px] sm:min-h-0"
                            >
                                <Trash2 size={14} className="text-slate-500" />
                                Remove from group
                            </TouchButton>
                        )}
                        {groups.map(g => {
                            const currentDancer = dancers.find(d => d.id === assigningDancerId);
                            const isCurrentGroup = currentDancer?.groupId === g.id;
                            if (isCurrentGroup) return null;
                            return (
                                <TouchButton
                                    key={g.id}
                                    onClick={() => handleAssignDancer(assigningDancerId, g.id)}
                                    className="w-full text-left px-3 py-2.5 sm:py-2 text-sm text-slate-300 hover:bg-slate-700 active:bg-slate-600 flex items-center gap-2 min-h-[44px] sm:min-h-0"
                                >
                                    <span
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: g.color }}
                                    />
                                    {g.name}
                                </TouchButton>
                            );
                        })}
                        {groups.length === 0 && (
                            <div className="px-3 py-2 text-xs text-slate-500">No groups</div>
                        )}
                        {/* Delete Dancer Option - Red for visibility */}
                        <div className="border-t border-slate-700 mt-1 pt-1">
                            <TouchButton
                                onClick={() => {
                                    if (assigningDancerId) {
                                        onDeleteDancer(assigningDancerId);
                                        setAssigningDancerId(null);
                                        setDropdownPosition(null);
                                    }
                                }}
                                className="w-full text-left px-3 py-2.5 sm:py-2 text-sm text-red-400 hover:bg-red-500/20 active:bg-red-500/30 flex items-center gap-2 min-h-[44px] sm:min-h-0"
                            >
                                <Trash2 size={14} />
                                Delete Dancer
                            </TouchButton>
                        </div>
                    </div>
                </>
            )}
            {/* Color Picker Dropdown */}
            {colorPickerDancerId && colorPickerAnchor && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onPointerUp={() => {
                            setColorPickerDancerId(null);
                            setColorPickerAnchor(null);
                        }}
                    />
                    <div
                        className="fixed bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 overflow-hidden p-3"
                        style={{
                            top: colorPickerAnchor.top,
                            left: colorPickerAnchor.left,
                        }}
                    >
                        <div className="text-xs text-slate-500 mb-2">Color</div>
                        <div className="grid grid-cols-6 gap-1.5">
                            {[
                                '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6',
                                '#8b5cf6', '#ec4899', '#f43f5e', '#14b8a6', '#6366f1', '#a855f7',
                                '#64748b', '#ffffff', '#000000', '#fbbf24', '#34d399', '#60a5fa',
                            ].map(c => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleColorChange(c);
                                        setColorPickerDancerId(null);
                                        setColorPickerAnchor(null);
                                    }}
                                    className={`w-7 h-7 rounded-full border-2 hover:scale-110 transition-transform cursor-pointer ${dancers.find(d => d.id === colorPickerDancerId)?.color === c ? 'border-white' : 'border-slate-600'}`}
                                    style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                        <div className="mt-2 pt-2 border-t border-slate-700">
                            <label className="flex items-center gap-2 text-xs text-slate-400">
                                Custom
                                <input
                                    type="color"
                                    value={dancers.find(d => d.id === colorPickerDancerId)?.color || '#ffffff'}
                                    onChange={(e) => {
                                        handleColorChange(e.target.value);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
                                />
                            </label>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
