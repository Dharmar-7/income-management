'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { apiFetch } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface NoteImage {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  dataUrl: string;
}

interface Note {
  id: string;
  title: string | null;
  content: string;
  color: string;
  isPinned: boolean;
  isArchived: boolean;
  isLocked: boolean;
  tags: string[];
  reminderAt: string | null;
  reminderSent: boolean;
  images: NoteImage[];
  createdAt: string;
  updatedAt: string;
}

// ─── Color system ───────────────────────────────────────────────────────────────

const COLORS: { value: string; bg: string; border: string; dot: string }[] = [
  { value: 'white',  bg: 'bg-white',        border: 'border-gray-200',   dot: '#ffffff' },
  { value: 'yellow', bg: 'bg-yellow-50',    border: 'border-yellow-200', dot: '#fef9c3' },
  { value: 'teal',   bg: 'bg-teal-50',      border: 'border-teal-200',   dot: '#ccfbf1' },
  { value: 'pink',   bg: 'bg-pink-50',      border: 'border-pink-200',   dot: '#fce7f3' },
  { value: 'blue',   bg: 'bg-blue-50',      border: 'border-blue-200',   dot: '#dbeafe' },
  { value: 'purple', bg: 'bg-purple-50',    border: 'border-purple-200', dot: '#f3e8ff' },
  { value: 'orange', bg: 'bg-orange-50',    border: 'border-orange-200', dot: '#ffedd5' },
  { value: 'green',  bg: 'bg-green-50',     border: 'border-green-200',  dot: '#dcfce7' },
  { value: 'mirror', bg: '',                border: '',                   dot: 'mirror'  },
];

const MIRROR_STYLE: React.CSSProperties = {
  background: [
    'linear-gradient(158deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.10) 35%, transparent 70%)',
    'rgba(255,255,255,0.15)',
  ].join(', '),
  backdropFilter: 'blur(40px) saturate(160%) brightness(1.04)',
  WebkitBackdropFilter: 'blur(40px) saturate(160%) brightness(1.04)',
  borderColor: 'rgba(255,255,255,0.65)',
  boxShadow: [
    '0 8px 48px rgba(0,0,0,0.14)',
    'inset 0 2px 0 rgba(255,255,255,0.95)',
    'inset 0 -1px 0 rgba(0,0,0,0.06)',
    'inset 1px 0 0 rgba(255,255,255,0.50)',
    'inset -1px 0 0 rgba(0,0,0,0.03)',
  ].join(', '),
};

function colorClasses(color: string) {
  return COLORS.find(c => c.value === color) ?? COLORS[0];
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatReminderDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Toggle a markdown checkbox at a given line index
function toggleCheckbox(content: string, lineIndex: number): string {
  const lines = content.split('\n');
  const line = lines[lineIndex];
  if (/- \[ \]/.test(line)) {
    lines[lineIndex] = line.replace('- [ ]', '- [x]');
  } else if (/- \[x\]/i.test(line)) {
    lines[lineIndex] = line.replace(/- \[x\]/i, '- [ ]');
  }
  return lines.join('\n');
}

// ─── Note Edit Modal ────────────────────────────────────────────────────────────

function NoteModal({
  note,
  allTags,
  onClose,
  onSave,
  onDelete,
}: {
  note: Note | null;     // null = create new
  allTags: string[];
  onClose: () => void;
  onSave: (data: Partial<Note> & { clearReminder?: boolean }) => Promise<Note>;
  onDelete?: () => Promise<void>;
}) {
  const { getToken } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(note?.title ?? '');
  const [content, setContent] = useState(note?.content ?? '');
  const [color, setColor] = useState(note?.color ?? 'white');
  const [tags, setTags] = useState<string[]>(note?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [reminderAt, setReminderAt] = useState<Date | null>(note?.reminderAt ? new Date(note.reminderAt) : null);
  const [images, setImages] = useState<NoteImage[]>(note?.images ?? []);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [lockModal, setLockModal] = useState<'set' | 'remove' | null>(null);
  const [isLocked, setIsLocked] = useState(note?.isLocked ?? false);

  const noteId = note?.id;
  const c = colorClasses(color);
  const isMirror = color === 'mirror';
  const lbl = isMirror ? 'text-gray-900 dark:text-white' : 'text-gray-400';
  function onReminderChange(date: Date | null) { setReminderAt(date); }
  const filteredSuggestions = allTags.filter(
    t => t.toLowerCase().includes(tagInput.toLowerCase()) && !tags.includes(t)
  );

  function addTag(t: string) {
    const cleaned = t.trim().toLowerCase();
    if (cleaned && !tags.includes(cleaned)) setTags(prev => [...prev, cleaned]);
    setTagInput('');
    setShowTagSuggestions(false);
  }

  function removeTag(t: string) {
    setTags(prev => prev.filter(x => x !== t));
  }

  async function handleSave() {
    setSaving(true);
    await onSave({
      title: title.trim() || undefined,
      content,
      color,
      tags,
      reminderAt: reminderAt ? reminderAt.toISOString() : undefined,
      clearReminder: (note?.reminderAt && !reminderAt) ? true : undefined,
    });
    setSaving(false);
    onClose();
  }

  async function handleLock(password: string) {
    const token = await getToken();
    await apiFetch(`/notes/${noteId}/lock`, token!, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    setIsLocked(true);
    setLockModal(null);
  }

  async function handleRemoveLock(password: string) {
    const token = await getToken();
    await apiFetch(`/notes/${noteId}/remove-lock`, token!, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    setIsLocked(false);
    setLockModal(null);
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!noteId || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    setUploading(true);
    try {
      const token = await getToken();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/notes/${noteId}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) { const b = await res.json(); throw new Error(b?.message); }
      const img: NoteImage = await res.json();
      setImages(prev => [...prev, img]);
    } catch (err: any) {
      alert(err.message ?? 'Image upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleDeleteImage(imageId: string) {
    if (!noteId) return;
    const token = await getToken();
    await apiFetch(`/notes/${noteId}/images/${imageId}`, token!, { method: 'DELETE' });
    setImages(prev => prev.filter(i => i.id !== imageId));
  }

  // Handle checkbox click in preview mode
  function handleCheckboxClick(lineIndex: number) {
    const newContent = toggleCheckbox(content, lineIndex);
    setContent(newContent);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={isMirror
        ? { backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', backgroundColor: 'rgba(0,0,0,0.12)' }
        : { backgroundColor: 'rgba(0,0,0,0.45)' }
      }
      onClick={onClose}
    >
      {lockModal && (
        <PasswordModal
          mode={lockModal}
          onSubmit={lockModal === 'set' ? handleLock : handleRemoveLock}
          onClose={() => setLockModal(null)}
        />
      )}
      <div
        style={isMirror ? { ...MIRROR_STYLE, boxShadow: '0 24px 60px rgba(0,0,0,0.22), inset 0 0 0 1px rgba(255,255,255,0.65)' } : undefined}
        className={`${isMirror ? '' : `${c.bg} ${c.border}`} border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className={`flex-1 bg-transparent text-lg font-semibold text-gray-900 ${isMirror ? 'dark:text-white' : ''} placeholder-gray-400 ${isMirror ? 'dark:placeholder-gray-300' : ''} outline-none`}
          />
          <button
            onClick={() => setPreview(p => !p)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${isMirror ? 'border-white/40 text-gray-900 dark:text-white hover:bg-white/20' : 'border-gray-300 text-gray-500 hover:bg-gray-100'}`}
          >
            {preview ? '✏️ Edit' : '👁 Preview'}
          </button>
          <button onClick={onClose} className={`text-gray-400 hover:text-gray-600 ${isMirror ? 'dark:text-gray-200 dark:hover:text-white' : ''} text-xl`}>✕</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5">
          {preview ? (
            <div className="prose prose-sm max-w-none min-h-32 pb-4">
              {content ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    input: ({ checked, ...props }) => {
                      // Find the line index of this checkbox in content
                      const lines = content.split('\n');
                      const checkboxLines = lines
                        .map((l, i) => ({ l, i }))
                        .filter(({ l }) => /- \[[ x]\]/i.test(l));
                      const idx = checked
                        ? checkboxLines.findIndex(({ l }) => /- \[x\]/i.test(l))
                        : checkboxLines.findIndex(({ l }) => /- \[ \]/.test(l));
                      const lineIndex = idx >= 0 ? checkboxLines[idx].i : -1;
                      return (
                        <input
                          type="checkbox"
                          checked={!!checked}
                          onChange={() => lineIndex >= 0 && handleCheckboxClick(lineIndex)}
                          className="cursor-pointer mr-1"
                          {...props}
                        />
                      );
                    },
                  }}
                >
                  {content}
                </ReactMarkdown>
              ) : (
                <p className="text-gray-400 text-sm">Nothing to preview yet.</p>
              )}
            </div>
          ) : (
            <textarea
              placeholder={`Write your note here...\n\nTip: Use markdown!\n**bold**  *italic*  # Heading\n- [ ] Checklist item\n- [x] Checked item`}
              value={content}
              onChange={e => setContent(e.target.value)}
              className={`w-full bg-transparent text-sm text-gray-800 ${isMirror ? 'dark:text-white' : ''} placeholder-gray-400 ${isMirror ? 'dark:placeholder-gray-300' : ''} outline-none resize-none min-h-48`}
              rows={10}
            />
          )}

          {/* Images */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2 mb-3">
              {images.map(img => (
                <div key={img.id} className="relative group">
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="w-24 h-24 object-cover rounded-lg border border-gray-200"
                  />
                  <button
                    onClick={() => handleDeleteImage(img.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer toolbar */}
        <div className={`border-t px-5 py-3 space-y-3 ${isMirror ? 'border-white/40' : 'border-gray-200/60'}`}>
          {/* Color picker */}
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${lbl}`}>Color:</span>
            {COLORS.map(c => (
              <button
                key={c.value}
                onClick={() => setColor(c.value)}
                style={c.value === 'mirror'
                  ? {
                      background: 'linear-gradient(145deg, #f5f5f5 0%, #ffffff 25%, #c8c8c8 50%, #f0f0f0 75%, #b8b8b8 100%)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.15)',
                    }
                  : { backgroundColor: c.dot }
                }
                className={`w-7 h-7 rounded-full border-2 transition-all ${
                  color === c.value ? 'border-gray-600 scale-110' : 'border-gray-300'
                }`}
                title={c.value === 'mirror' ? 'Mirror (glass)' : c.value}
              />
            ))}
          </div>

          {/* Tags */}
          <div className="relative">
            <div className="flex flex-wrap gap-1.5 items-center">
              {tags.map(t => (
                <span
                  key={t}
                  className="flex items-center gap-1 text-sm bg-white/60 border border-gray-300 text-gray-600 rounded-full px-2.5 py-1"
                >
                  #{t}
                  <button onClick={() => removeTag(t)} className="text-gray-400 hover:text-gray-600 leading-none">×</button>
                </span>
              ))}
              <input
                type="text"
                placeholder="+ tag"
                value={tagInput}
                onChange={e => { setTagInput(e.target.value); setShowTagSuggestions(true); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput); }
                  if (e.key === 'Escape') setShowTagSuggestions(false);
                }}
                onFocus={() => setShowTagSuggestions(true)}
                className={`text-sm bg-transparent outline-none w-20 ${isMirror ? 'text-gray-900 dark:text-white placeholder-gray-700 dark:placeholder-gray-300' : 'text-gray-600 placeholder-gray-400'}`}
              />
            </div>
            {showTagSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute bottom-full mb-1 left-0 bg-white rounded-xl border border-gray-200 shadow-lg z-10 overflow-hidden">
                {filteredSuggestions.map(t => (
                  <button
                    key={t}
                    onClick={() => addTag(t)}
                    className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    #{t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Reminder */}
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${lbl}`}>⏰ Remind:</span>
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-md px-2 py-1 cursor-pointer focus-within:border-gray-400">
              <span className="text-gray-400 text-sm leading-none">📅</span>
              <DatePicker
                selected={reminderAt}
                onChange={onReminderChange}
                showTimeSelect
                timeFormat="HH:mm"
                timeIntervals={15}
                dateFormat="dd MMM yyyy, HH:mm"
                minDate={new Date()}
                placeholderText="Pick date & time"
                popperPlacement="top-start"
                className={`text-sm outline-none cursor-pointer bg-transparent w-40 ${isMirror ? 'text-gray-900 dark:text-white' : 'text-gray-700'}`}
                calendarClassName="!rounded-2xl !shadow-xl !border-gray-100"
              />
            </div>
            {reminderAt && (
              <button
                onClick={() => setReminderAt(null)}
                className={`text-sm ${isMirror ? 'text-gray-500 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}
              >
                Clear
              </button>
            )}
          </div>

          {/* Image upload */}
          {noteId && (
            <div className="flex items-center gap-2">
              <input type="file" ref={fileRef} accept="image/*" onChange={handleImageUpload} className="hidden" />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className={`text-sm flex items-center gap-1.5 disabled:opacity-50 ${isMirror ? 'text-gray-900 dark:text-white hover:text-black dark:hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
              >
                🖼️ {uploading ? 'Uploading…' : 'Add image'}
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex gap-2">
              {onDelete && (
                <button
                  onClick={async () => { await onDelete(); onClose(); }}
                  className={`text-sm px-3 py-2 rounded-lg hover:bg-rose-50 hover:text-rose-500 transition-colors ${lbl}`}
                >
                  🗑️ Delete
                </button>
              )}
              {noteId && (
                <button
                  onClick={() => setLockModal(isLocked ? 'remove' : 'set')}
                  className={`text-sm px-3 py-2 rounded-lg transition-colors ${
                    isLocked
                      ? 'text-amber-600 hover:bg-amber-50'
                      : `hover:bg-gray-100 ${lbl}`
                  }`}
                >
                  {isLocked ? '🔓 Unlock' : '🔒 Lock'}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className={`px-4 py-2 text-sm rounded-xl transition-colors ${isMirror ? 'text-gray-900 dark:text-white hover:bg-white/40' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-semibold bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Password Modal ─────────────────────────────────────────────────────────────

function PasswordModal({
  mode,
  onSubmit,
  onClose,
}: {
  mode: 'set' | 'enter' | 'remove';
  onSubmit: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const title = mode === 'set' ? '🔒 Lock Note' : mode === 'remove' ? '🔓 Remove Lock' : '🔒 Enter Password';
  const hint  = mode === 'set' ? 'Set a password to lock this note.' : mode === 'remove' ? 'Enter your password to remove the lock.' : 'This note is locked. Enter password to open.';

  async function handleSubmit() {
    setError('');
    if (mode === 'set') {
      if (password.length < 4) { setError('Password must be at least 4 characters.'); return; }
      if (password !== confirm) { setError('Passwords do not match.'); return; }
    }
    if (!password) { setError('Please enter a password.'); return; }
    setLoading(true);
    try {
      await onSubmit(password);
    } catch (e: any) {
      setError(e?.message ?? 'Incorrect password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900 mb-1">{title}</h2>
        <p className="text-sm text-gray-500 mb-4">{hint}</p>
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          autoFocus
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-gray-400 mb-2"
        />
        {mode === 'set' && (
          <input
            type="password"
            placeholder="Confirm password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-gray-400 mb-2"
          />
        )}
        {error && <p className="text-xs text-rose-500 mb-2">{error}</p>}
        <div className="flex gap-2 justify-end mt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-xl">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 text-sm font-semibold bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? '…' : mode === 'set' ? 'Lock' : mode === 'remove' ? 'Remove Lock' : 'Open'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Note Card ──────────────────────────────────────────────────────────────────

function NoteCard({ note, onClick }: { note: Note; onClick: () => void }) {
  const c = colorClasses(note.color);
  const isMirror = note.color === 'mirror';
  const preview = note.content.slice(0, 200);

  return (
    <div
      onClick={onClick}
      style={isMirror ? MIRROR_STYLE : undefined}
      className={`${isMirror ? '' : `${c.bg} ${c.border}`} border rounded-2xl p-4 cursor-pointer hover:shadow-md transition-all group break-inside-avoid mb-4`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          {note.isPinned && <span className="text-xs text-gray-500">📌</span>}
          {note.isLocked && <span className="text-xs text-gray-500">🔒</span>}
        </div>
      </div>
      {note.title && (
        <h3 className={`font-semibold mb-1 text-sm ${isMirror ? 'text-gray-900 dark:text-white' : 'text-gray-900'}`}>{note.title}</h3>
      )}
      {note.isLocked ? (
        <div className="text-xs text-gray-400 italic">Protected note</div>
      ) : preview ? (
        <div className={`text-xs whitespace-pre-wrap line-clamp-6 ${isMirror ? 'text-gray-700 dark:text-gray-100' : 'text-gray-700'}`}>
          {preview}{note.content.length > 200 ? '…' : ''}
        </div>
      ) : null}
      {note.images.length > 0 && (
        <div className="mt-2 flex gap-1">
          <img src={note.images[0].dataUrl} alt="" className="w-16 h-16 object-cover rounded-lg" />
          {note.images.length > 1 && (
            <div className="w-16 h-16 bg-white/50 dark:bg-white/20 rounded-lg flex items-center justify-center text-xs text-gray-600 dark:text-gray-200">
              +{note.images.length - 1}
            </div>
          )}
        </div>
      )}
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {note.tags.map(t => (
            <span key={t} className="text-xs text-gray-500">#{t}</span>
          ))}
        </div>
      )}
      {note.reminderAt && !note.reminderSent && (
        <div className="text-xs text-amber-700 mt-2">⏰ {formatReminderDate(note.reminderAt)}</div>
      )}
    </div>
  );
}

// ─── Quick Create Bar ───────────────────────────────────────────────────────────

function QuickCreateBar({ onCreated }: { onCreated: (note: Note) => void }) {
  const { getToken } = useAuth();
  const [focused, setFocused] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!title.trim() && !content.trim()) { setFocused(false); return; }
    setSaving(true);
    try {
      const token = await getToken();
      const note = await apiFetch<Note>('/notes', token!, {
        method: 'POST',
        body: JSON.stringify({ title: title.trim() || undefined, content }),
      });
      onCreated(note);
      setTitle('');
      setContent('');
      setFocused(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-5 py-4 mb-8 max-w-xl mx-auto">
      {focused && (
        <input
          type="text"
          placeholder="Title (optional)"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="w-full text-sm font-semibold text-gray-900 outline-none placeholder-gray-400 mb-2"
        />
      )}
      {focused ? (
        <textarea
          placeholder="Write your note… (Enter for new line)"
          value={content}
          onChange={e => setContent(e.target.value)}
          autoFocus
          rows={4}
          className="w-full bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none resize-none"
        />
      ) : (
        <input
          type="text"
          placeholder="Take a note…"
          value={content}
          onChange={e => setContent(e.target.value)}
          onFocus={() => setFocused(true)}
          className="w-full text-sm text-gray-700 outline-none placeholder-gray-400"
        />
      )}
      {focused && (
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={() => { setFocused(false); setTitle(''); setContent(''); }}
            className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="px-4 py-1.5 text-sm font-semibold bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
          >
            {saving ? '…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function NotesManager() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [editNote, setEditNote] = useState<Note | null | 'new'>('new');
  const [showArchived, setShowArchived] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<Note | null>(null);

  async function handleNoteClick(note: Note) {
    if (!note.isLocked) { setEditNote(note); return; }
    setUnlockTarget(note);
  }

  async function handleUnlock(password: string) {
    if (!unlockTarget) return;
    const token = await getToken();
    const full = await apiFetch<Note>(`/notes/${unlockTarget.id}/unlock`, token!, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    setUnlockTarget(null);
    setEditNote(full);
  }

  // ── Reminder polling — check every 60s when tab is open ──────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    async function checkReminders() {
      // Skip while the tab is hidden — no point polling (and paying an API
      // call) for notifications nobody can see; resumes on next tick.
      if (document.hidden) return;
      try {
        const token = await getToken();
        const due = await apiFetch<{ id: string; title: string | null; content: string }[]>(
          '/notes/reminders/due', token!,
        );
        if (due.length > 0 && 'Notification' in window) {
          Notification.requestPermission().then(perm => {
            if (perm === 'granted') {
              due.forEach(n => {
                new Notification(n.title ?? 'Note reminder', {
                  body: n.content.slice(0, 80),
                  icon: '/favicon.ico',
                });
              });
            }
          });
          queryClient.invalidateQueries({ queryKey: ['notes'] });
        }
      } catch { /* silent */ }
    }

    timer = setInterval(checkReminders, 60_000);
    return () => clearInterval(timer);
  }, [getToken, queryClient]);

  // ── Data fetching ────────────────────────────────────────────────────────
  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['notes', search, activeTag, showArchived],
    queryFn: async () => {
      const token = await getToken();
      const params = new URLSearchParams({
        ...(search && { search }),
        ...(activeTag && { tag: activeTag }),
      });
      const endpoint = showArchived ? '/notes/archived' : `/notes?${params}`;
      return apiFetch<Note[]>(endpoint, token!);
    },
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['note-tags'],
    queryFn: async () => {
      const token = await getToken();
      return apiFetch<string[]>('/notes/tags', token!);
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    queryClient.invalidateQueries({ queryKey: ['note-tags'] });
  }

  async function handleSave(data: Partial<Note> & { clearReminder?: boolean }) {
    const token = await getToken();
    if (editNote && editNote !== 'new') {
      const updated = await apiFetch<Note>(`/notes/${editNote.id}`, token!, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      invalidate();
      return updated;
    } else {
      const created = await apiFetch<Note>('/notes', token!, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      invalidate();
      return created;
    }
  }

  async function handleDelete() {
    if (!editNote || editNote === 'new') return;
    const token = await getToken();
    await apiFetch(`/notes/${editNote.id}`, token!, { method: 'DELETE' });
    invalidate();
  }

  async function togglePin(note: Note, e: React.MouseEvent) {
    e.stopPropagation();
    const token = await getToken();
    await apiFetch(`/notes/${note.id}`, token!, {
      method: 'PATCH',
      body: JSON.stringify({ isPinned: !note.isPinned }),
    });
    invalidate();
  }

  async function archiveNote(note: Note, e: React.MouseEvent) {
    e.stopPropagation();
    const token = await getToken();
    await apiFetch(`/notes/${note.id}`, token!, {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: true }),
    });
    invalidate();
  }

  async function unarchiveNote(note: Note, e: React.MouseEvent) {
    e.stopPropagation();
    const token = await getToken();
    await apiFetch(`/notes/${note.id}`, token!, {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: false }),
    });
    invalidate();
  }

  const pinned = notes.filter(n => n.isPinned);
  const others = notes.filter(n => !n.isPinned);

  return (
    <>
      {/* Unlock modal */}
      {unlockTarget && (
        <PasswordModal
          mode="enter"
          onSubmit={handleUnlock}
          onClose={() => setUnlockTarget(null)}
        />
      )}

      {/* Edit / Create modal */}
      {editNote !== null && (
        <NoteModal
          note={editNote === 'new' ? null : editNote}
          allTags={allTags}
          onClose={() => setEditNote(null)}
          onSave={handleSave}
          onDelete={editNote !== 'new' ? handleDelete : undefined}
        />
      )}

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-48">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Search notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-gray-400"
          />
        </div>

        <button
          onClick={() => setShowArchived(a => !a)}
          className={`text-sm px-4 py-2 rounded-full border transition-colors ${
            showArchived
              ? 'bg-gray-800 text-white border-gray-800'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}
        >
          {showArchived ? '← Back' : '🗄️ Archive'}
        </button>

        <button
          onClick={() => setEditNote('new')}
          className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 shadow-sm"
        >
          + New Note
        </button>
      </div>

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setActiveTag('')}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              !activeTag ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            All
          </button>
          {allTags.map(t => (
            <button
              key={t}
              onClick={() => setActiveTag(activeTag === t ? '' : t)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                activeTag === t ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      {/* Quick create bar (only in main view) */}
      {!showArchived && !search && !activeTag && (
        <QuickCreateBar onCreated={() => invalidate()} />
      )}

      {/* Loading */}
      {isLoading && (
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-4">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="bg-gray-100 rounded-2xl h-32 animate-pulse mb-4 break-inside-avoid" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && notes.length === 0 && (
        <div className="text-center py-24 text-gray-400">
          <div className="text-5xl mb-4">📝</div>
          <p className="text-lg font-medium">
            {showArchived ? 'No archived notes.' : search ? 'No notes match your search.' : 'No notes yet.'}
          </p>
          {!showArchived && !search && (
            <p className="text-sm mt-1">Click "+ New Note" or use the bar above to create one.</p>
          )}
        </div>
      )}

      {/* Pinned section */}
      {!isLoading && pinned.length > 0 && (
        <>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">📌 Pinned</p>
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 mb-6">
            {pinned.map(note => (
              <div key={note.id} className="relative group break-inside-avoid">
                <NoteCard note={note} onClick={() => handleNoteClick(note)} />
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={e => togglePin(note, e)} title="Unpin" className="w-7 h-7 bg-white/80 rounded-full text-sm flex items-center justify-center hover:bg-white shadow-sm">📌</button>
                  {showArchived
                    ? <button onClick={e => unarchiveNote(note, e)} title="Unarchive" className="w-7 h-7 bg-white/80 rounded-full text-sm flex items-center justify-center hover:bg-white shadow-sm">📤</button>
                    : <button onClick={e => archiveNote(note, e)} title="Archive" className="w-7 h-7 bg-white/80 rounded-full text-sm flex items-center justify-center hover:bg-white shadow-sm">🗄️</button>
                  }
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Others section */}
      {!isLoading && others.length > 0 && (
        <>
          {pinned.length > 0 && (
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Others</p>
          )}
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-4">
            {others.map(note => (
              <div key={note.id} className="relative group break-inside-avoid">
                <NoteCard note={note} onClick={() => handleNoteClick(note)} />
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={e => togglePin(note, e)} title="Pin" className="w-7 h-7 bg-white/80 rounded-full text-sm flex items-center justify-center hover:bg-white shadow-sm">📌</button>
                  {showArchived
                    ? <button onClick={e => unarchiveNote(note, e)} title="Unarchive" className="w-7 h-7 bg-white/80 rounded-full text-sm flex items-center justify-center hover:bg-white shadow-sm">📤</button>
                    : <button onClick={e => archiveNote(note, e)} title="Archive" className="w-7 h-7 bg-white/80 rounded-full text-sm flex items-center justify-center hover:bg-white shadow-sm">🗄️</button>
                  }
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
