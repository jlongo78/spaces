'use client';

import { useState, useRef, useEffect } from 'react';
import { Tag as TagIcon, X, Plus, Palette, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTags, useAddTag, useRemoveTag, useDeleteTag, useUpdateTagColor } from '@/hooks/use-sessions';
import type { Tag } from '@/types/claude';
import { ColorPicker } from './color-picker';

interface TagPickerProps {
  sessionId: string;
  currentTags: string[];
  tagObjects?: Tag[];
  compact?: boolean;
}

export function TagPicker({ sessionId, currentTags, tagObjects, compact }: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [editingTag, setEditingTag] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const { data: allTags } = useTags();
  const addTag = useAddTag();
  const removeTag = useRemoveTag();
  const deleteTag = useDeleteTag();
  const updateColor = useUpdateTagColor();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingTag(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const availableTags = (allTags || []).filter(t => !currentTags.includes(t.name));

  return (
    <div ref={ref} className="relative inline-block">
      {/* Current tags */}
      <div className="flex items-center gap-1 flex-wrap">
        {(tagObjects || []).map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border"
            style={{
              backgroundColor: `${tag.color}15`,
              borderColor: `${tag.color}40`,
              color: tag.color,
            }}
          >
            {tag.name}
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeTag.mutate({ sessionId, tagName: tag.name });
              }}
              className="hover:opacity-70"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        {/* Tags without objects (fallback to names only) */}
        {currentTags.filter(t => !tagObjects?.find(to => to.name === t)).map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
          >
            {tag}
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeTag.mutate({ sessionId, tagName: tag });
              }}
              className="hover:opacity-70"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}

        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors',
            compact && 'p-1'
          )}
        >
          <Plus className="w-3 h-3" />
          {!compact && 'tag'}
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg z-50 py-1">
          {/* Create new */}
          <div className="px-2 py-1.5 border-b border-zinc-100 dark:border-zinc-800">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newTagName.trim()) {
                  addTag.mutate({ sessionId, tagName: newTagName.trim() });
                  setNewTagName('');
                }
              }}
              className="flex items-center gap-1"
            >
              <TagIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                placeholder="New tag name..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className="flex-1 text-xs bg-transparent focus:outline-none"
                autoFocus
              />
              {newTagName && (
                <button type="submit" className="text-xs text-indigo-500 hover:text-indigo-600 font-medium">
                  Add
                </button>
              )}
            </form>
          </div>

          {/* Existing tags */}
          {availableTags.length > 0 && (
            <div className="max-h-40 overflow-y-auto">
              {availableTags.map((tag) => (
                <div key={tag.id} className="group">
                  <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <button
                      onClick={() => {
                        addTag.mutate({ sessionId, tagName: tag.name });
                      }}
                      className="flex items-center gap-2 flex-1 text-left"
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                      <span className="text-xs truncate">{tag.name}</span>
                    </button>
                    <div className="hidden group-hover:flex items-center gap-0.5">
                      <button
                        onClick={() => setEditingTag(editingTag === tag.id ? null : tag.id)}
                        className="p-0.5 text-muted-foreground hover:text-foreground"
                        title="Change color"
                      >
                        <Palette className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete tag "${tag.name}"?`)) deleteTag.mutate(tag.id);
                        }}
                        className="p-0.5 text-muted-foreground hover:text-red-500"
                        title="Delete tag"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  {editingTag === tag.id && (
                    <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50">
                      <ColorPicker
                        value={tag.color}
                        onChange={(color) => {
                          updateColor.mutate({ tagId: tag.id, color });
                          setEditingTag(null);
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {availableTags.length === 0 && !newTagName && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {(allTags || []).length === 0 ? 'No tags yet. Type to create one.' : 'All tags applied.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
