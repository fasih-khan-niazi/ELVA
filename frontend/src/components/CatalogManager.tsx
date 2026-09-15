import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import ConfirmDialog from './ConfirmDialog';
import { Plus, Trash2, Edit2, Package, Tag, ToggleLeft, ToggleRight, RefreshCw, Loader2, Check, X } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface CatalogItemOption {
    name: string;
    choices: string[];
}

interface CatalogItemData {
    _id?: string;
    name: string;
    description: string;
    price: number;
    category: string;
    imageUrl?: string;
    available: boolean;
    options: CatalogItemOption[];
}

const EMPTY_ITEM: CatalogItemData = {
    name: '',
    description: '',
    price: 0,
    category: 'General',
    available: true,
    options: []
};

const CURRENCY_SYMBOLS: Record<string, string> = {
    USD: '$', PKR: 'Rs.', EUR: '€', GBP: '£', INR: '₹',
    AED: 'AED ', SAR: 'SAR ', CAD: 'C$', AUD: 'A$',
};

export default function CatalogManager({
    agentId,
    currency,
    duplicateFromAgents = [],
}: {
    agentId: string;
    currency?: string;
    duplicateFromAgents?: Array<{ _id: string; name: string }>;
}) {
    const sym = CURRENCY_SYMBOLS[currency || 'USD'] || '$';
    const { token } = useAuth();
    const toast = useToast();
    const [items, setItems] = useState<CatalogItemData[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Edit state
    const [editingItem, setEditingItem] = useState<CatalogItemData | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [duplicating, setDuplicating] = useState(false);
    const [duplicateSourceId, setDuplicateSourceId] = useState('');

    const fetchItems = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/catalog/${agentId}/items`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to load catalog');
            const data = await res.json();
            setItems(data);
        } catch (err: any) {
            toast.error('Could not load catalog', err.message);
        } finally {
            setLoading(false);
        }
    }, [agentId, token]);

    useEffect(() => {
        fetchItems();
    }, [fetchItems]);

    const handleSave = async () => {
        if (!editingItem) return;
        if (!editingItem.name.trim()) {
            toast.warning('Item name is required');
            return;
        }
        if (editingItem.price < 0) {
            toast.warning('Price cannot be negative');
            return;
        }

        setSaving(true);
        try {
            const isUpdate = !!editingItem._id;
            const url = isUpdate
                ? `${API_BASE}/api/catalog/${agentId}/items/${editingItem._id}`
                : `${API_BASE}/api/catalog/${agentId}/items`;

            const res = await fetch(url, {
                method: isUpdate ? 'PUT' : 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(editingItem)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({ message: 'Failed' }));
                throw new Error(errData.message || 'Failed to save item');
            }

            setEditingItem(null);
            setIsCreating(false);
            toast.success(isUpdate ? 'Item updated' : 'Item added');
            await fetchItems();
        } catch (err: any) {
            toast.error('Save failed', err.message);
        } finally {
            setSaving(false);
        }
    };

    const confirmDeleteItem = async () => {
        if (!deleteConfirmId) return;
        const itemId = deleteConfirmId;
        setDeletingId(itemId);
        try {
            const res = await fetch(`${API_BASE}/api/catalog/${agentId}/items/${itemId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to delete');
            toast.success('Item deleted');
            setDeleteConfirmId(null);
            await fetchItems();
        } catch (err: any) {
            toast.error('Delete failed', err.message);
        } finally {
            setDeletingId(null);
        }
    };

    const handleToggleAvailability = async (item: CatalogItemData) => {
        try {
            const res = await fetch(`${API_BASE}/api/catalog/${agentId}/items/${item._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ available: !item.available })
            });
            if (!res.ok) throw new Error('Failed to update');
            await fetchItems();
        } catch (err: any) {
            toast.error('Update failed', err.message);
        }
    };

    const runDuplicateCatalog = async () => {
        if (!duplicateSourceId) return;
        setDuplicating(true);
        try {
            const res = await fetch(
                `${API_BASE}/api/catalog/${agentId}/duplicate-from/${duplicateSourceId}`,
                { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'Duplicate failed');
            toast.success('Menu copied', data.message);
            setDuplicateConfirmOpen(false);
            setDuplicateSourceId('');
            await fetchItems();
        } catch (err: any) {
            toast.error('Duplicate failed', err.message);
        } finally {
            setDuplicating(false);
        }
    };

    const handleDuplicateCatalog = () => {
        if (!duplicateSourceId) {
            toast.warning('Choose an agent to copy from');
            return;
        }
        setDuplicateConfirmOpen(true);
    };

    const handleSyncToRAG = async () => {
        setSyncing(true);
        try {
            const res = await fetch(`${API_BASE}/api/catalog/${agentId}/sync`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({ message: 'Sync failed' }));
                throw new Error(errData.message);
            }
            const data = await res.json();
            toast.success('Synced to knowledge base', `${data.itemCount} items · ${data.chunksUpserted} chunks`);
        } catch (err: any) {
            toast.error('Sync failed', err.message);
        } finally {
            setSyncing(false);
        }
    };

    const startCreate = () => {
        setEditingItem({ ...EMPTY_ITEM });
        setIsCreating(true);
    };

    const startEdit = (item: CatalogItemData) => {
        setEditingItem({ ...item, options: item.options ? [...item.options] : [] });
        setIsCreating(false);
    };

    const cancelEdit = () => {
        setEditingItem(null);
        setIsCreating(false);
    };

    // Group items by category
    const categories = new Map<string, CatalogItemData[]>();
    for (const item of items) {
        const cat = item.category || 'General';
        if (!categories.has(cat)) categories.set(cat, []);
        categories.get(cat)!.push(item);
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-ocean-deep" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-ocean-navy flex items-center">
                        <Package className="h-5 w-5 mr-2 text-ocean-deep" />
                        Product Catalog / Menu
                    </h3>
                    <p className="text-sm text-ocean-deep/80 mt-1">{items.length} item{items.length !== 1 ? 's' : ''} total</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleSyncToRAG}
                        disabled={syncing || items.length === 0}
                        className="flex items-center px-4 py-2 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors text-sm font-medium disabled:opacity-50"
                    >
                        {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                        Sync to AI
                    </button>
                    <button
                        onClick={startCreate}
                        className="flex items-center px-4 py-2 bg-ocean-deep text-white rounded-lg hover:bg-ocean-rich transition-colors text-sm font-medium"
                    >
                        <Plus className="h-4 w-4 mr-1.5" />
                        Add Item
                    </button>
                </div>
            </div>

            {/* Duplicate from another agent */}
            {duplicateFromAgents.length > 0 && (
                <div className="rounded-xl border border-ocean-ice/80 bg-ocean-powder/30 p-4">
                    <p className="text-sm font-medium text-ocean-navy mb-2">Copy menu from another agent</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <select
                            value={duplicateSourceId}
                            onChange={(e) => setDuplicateSourceId(e.target.value)}
                            className="flex-1 rounded-lg border border-ocean-ice px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-ocean-bright"
                        >
                            <option value="">Select agent…</option>
                            {duplicateFromAgents.map((a) => (
                                <option key={a._id} value={a._id}>{a.name}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={() => void handleDuplicateCatalog()}
                            disabled={duplicating || !duplicateSourceId}
                            className="shrink-0 rounded-lg border border-ocean-deep/20 bg-white px-4 py-2 text-sm font-medium text-ocean-deep hover:bg-ocean-powder disabled:opacity-50"
                        >
                            {duplicating ? 'Copying…' : 'Duplicate menu'}
                        </button>
                    </div>
                </div>
            )}

            {/* Edit / Create Form */}
            {editingItem && (
                <div className="bg-ocean-powder border border-ocean-ice rounded-xl p-6 space-y-4">
                    <h4 className="font-semibold text-ocean-navy">
                        {isCreating ? 'Add New Item' : `Editing: ${editingItem.name}`}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-ocean-deep mb-1">Item Name *</label>
                            <input
                                type="text"
                                value={editingItem.name}
                                onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                                className="w-full px-3 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none"
                                placeholder="e.g., Margherita Pizza"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-ocean-deep mb-1">Price ({sym}) *</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={editingItem.price}
                                    onChange={(e) => setEditingItem({ ...editingItem, price: parseFloat(e.target.value) || 0 })}
                                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-ocean-deep mb-1">Category</label>
                                <input
                                    type="text"
                                    value={editingItem.category}
                                    onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                                    className="w-full px-3 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none"
                                    placeholder="e.g., Pizza, Drinks, Appetizers"
                                />
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-1">Description</label>
                        <textarea
                            value={editingItem.description}
                            onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                            rows={2}
                            className="w-full px-3 py-2 border border-ocean-ice rounded-lg focus:ring-2 focus:ring-ocean-bright focus:border-ocean-deep outline-none"
                            placeholder="Brief description of the item..."
                        />
                    </div>

                    {/* Options (e.g., Size: Small, Medium, Large) */}
                    <div>
                        <label className="block text-sm font-medium text-ocean-deep mb-2">Options / Variants</label>
                        {editingItem.options.map((opt, idx) => (
                            <div key={idx} className="flex gap-2 items-center mb-2">
                                <input
                                    type="text"
                                    value={opt.name}
                                    onChange={(e) => {
                                        const updated = [...editingItem.options];
                                        updated[idx] = { ...updated[idx], name: e.target.value };
                                        setEditingItem({ ...editingItem, options: updated });
                                    }}
                                    className="w-32 px-3 py-1.5 border border-ocean-ice rounded-lg text-sm"
                                    placeholder="e.g., Size"
                                />
                                <input
                                    type="text"
                                    value={opt.choices.join(', ')}
                                    onChange={(e) => {
                                        const updated = [...editingItem.options];
                                        updated[idx] = { ...updated[idx], choices: e.target.value.split(',').map(s => s.trim()).filter(Boolean) };
                                        setEditingItem({ ...editingItem, options: updated });
                                    }}
                                    className="flex-1 px-3 py-1.5 border border-ocean-ice rounded-lg text-sm"
                                    placeholder="Choices (comma-separated): Small, Medium, Large"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        const updated = editingItem.options.filter((_, i) => i !== idx);
                                        setEditingItem({ ...editingItem, options: updated });
                                    }}
                                    className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => setEditingItem({ ...editingItem, options: [...editingItem.options, { name: '', choices: [] }] })}
                            className="text-sm text-ocean-deep hover:text-ocean-navy font-medium"
                        >
                            + Add Option
                        </button>
                    </div>

                    <div className="flex items-center gap-3">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={editingItem.available}
                                onChange={(e) => setEditingItem({ ...editingItem, available: e.target.checked })}
                                className="h-4 w-4 text-ocean-deep rounded"
                            />
                            <span className="text-sm text-ocean-deep">Available</span>
                        </label>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-4 py-2 border border-ocean-ice text-ocean-deep rounded-lg hover:bg-ocean-powder text-sm"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className="px-4 py-2 bg-ocean-deep text-white rounded-lg hover:bg-ocean-rich disabled:opacity-50 text-sm font-medium flex items-center"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Check className="h-4 w-4 mr-1.5" />}
                            {isCreating ? 'Add Item' : 'Update Item'}
                        </button>
                    </div>
                </div>
            )}

            {/* Item List */}
            {items.length === 0 && !editingItem ? (
                <div className="text-center py-12 text-ocean-deep/80">
                    <Package className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium text-ocean-deep">No catalog items yet</p>
                    <p className="text-sm mt-1">Add products or menu items so your agent can discuss them with customers.</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {Array.from(categories.entries()).map(([category, catItems]) => (
                        <div key={category}>
                            <h4 className="text-sm font-semibold text-ocean-deep/80 uppercase tracking-wider mb-3 flex items-center">
                                <Tag className="h-3.5 w-3.5 mr-1.5" />
                                {category} ({catItems.length})
                            </h4>
                            <div className="space-y-2">
                                {catItems.map((item) => (
                                    <div
                                        key={item._id}
                                        className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                                            item.available
                                                ? 'bg-white border-ocean-ice hover:shadow-md'
                                                : 'bg-ocean-powder border-ocean-ice/80 opacity-60'
                                        }`}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3">
                                                <span className="font-semibold text-ocean-navy">{item.name}</span>
                                                <span className="flex items-center text-sm font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded">
                                                    {sym}{item.price.toFixed(2)}
                                                </span>
                                                {!item.available && (
                                                    <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-600">Unavailable</span>
                                                )}
                                            </div>
                                            {item.description && (
                                                <p className="text-sm text-ocean-deep/80 mt-1 truncate">{item.description}</p>
                                            )}
                                            {item.options && item.options.length > 0 && (
                                                <div className="flex gap-2 mt-1.5 flex-wrap">
                                                    {item.options.map((opt, idx) => (
                                                        <span key={idx} className="text-xs bg-ocean-powder text-ocean-deep px-2 py-0.5 rounded">
                                                            {opt.name}: {opt.choices.join(', ')}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 ml-4">
                                            <button
                                                onClick={() => handleToggleAvailability(item)}
                                                className="p-2 rounded-lg hover:bg-ocean-mist/50 transition-colors"
                                                title={item.available ? 'Mark unavailable' : 'Mark available'}
                                            >
                                                {item.available
                                                    ? <ToggleRight className="h-5 w-5 text-green-600" />
                                                    : <ToggleLeft className="h-5 w-5 text-ocean-deep/60" />
                                                }
                                            </button>
                                            <button
                                                onClick={() => startEdit(item)}
                                                className="p-2 rounded-lg hover:bg-ocean-mist/50 transition-colors"
                                            >
                                                <Edit2 className="h-4 w-4 text-ocean-deep/90" />
                                            </button>
                                            <button
                                                onClick={() => item._id && setDeleteConfirmId(item._id)}
                                                className="p-2 rounded-lg hover:bg-red-50 transition-colors"
                                            >
                                                <Trash2 className="h-4 w-4 text-red-500" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Sync hint */}
            {items.length > 0 && (
                <div className="text-center pt-4 border-t border-ocean-ice/80">
                    <p className="text-xs text-ocean-deep/60">
                        After adding or updating items, click <strong>"Sync to AI"</strong> so your agent knows about the latest catalog.
                    </p>
                </div>
            )}
            <ConfirmDialog
                open={!!deleteConfirmId}
                onOpenChange={(open) => { if (!open && !deletingId) setDeleteConfirmId(null); }}
                title="Delete catalog item?"
                description="Remove this item from the menu? This cannot be undone."
                confirmLabel="Delete"
                destructive
                loading={!!deletingId}
                onConfirm={confirmDeleteItem}
            />
            <ConfirmDialog
                open={duplicateConfirmOpen}
                onOpenChange={setDuplicateConfirmOpen}
                title="Replace menu from another agent?"
                description={
                    duplicateSourceId
                        ? `Replace this agent's menu with a copy from ${duplicateFromAgents.find((a) => a._id === duplicateSourceId)?.name || 'the selected agent'}?`
                        : 'This will replace the current menu.'
                }
                confirmLabel="Copy menu"
                destructive
                loading={duplicating}
                onConfirm={runDuplicateCatalog}
            />
        </div>
    );
}
