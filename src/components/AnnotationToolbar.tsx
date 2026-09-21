import React from 'react';
import {
  MousePointer2,
  Type,
  Highlighter,
  Pencil,
  X,
  Check,
  Signature,
  Bold,
  Italic,
} from 'lucide-react';
import {
  INK_COLORS,
  HIGHLIGHT_COLORS,
  TEXT_FONTS,
  type AnnotationKind,
  type EditorTool,
  type TextFont,
} from '../utils/annotations';

interface AnnotationToolbarProps {
  tool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  /**
   * Whose properties the options row edits: the selected mark's kind when
   * something is selected, otherwise the active tool's. Null hides the row.
   */
  editingKind: AnnotationKind | null;
  /** True when the row is editing an existing mark rather than tool defaults. */
  hasSelection: boolean;
  color: string | null;
  onColorChange: (color: string) => void;
  size: number | null;
  onSizeChange: (size: number) => void;
  opacity: number | null;
  onOpacityChange: (opacity: number) => void;
  /** Called as a slider drag or swatch click begins, to snapshot for undo. */
  onEditStart: () => void;
  /** Text styling — shown only while text is the kind being edited. */
  textFont: TextFont;
  bold: boolean;
  italic: boolean;
  onTextStyleChange: (style: { font?: TextFont; bold?: boolean; italic?: boolean }) => void;
}

const TOOLS: { id: EditorTool; label: string; icon: React.ReactNode }[] = [
  { id: 'select', label: 'Select', icon: <MousePointer2 size={18} /> },
  { id: 'text', label: 'Text', icon: <Type size={18} /> },
  { id: 'highlight', label: 'Highlight', icon: <Highlighter size={18} /> },
  { id: 'pencil', label: 'Pencil', icon: <Pencil size={18} /> },
  { id: 'cross', label: 'Cross', icon: <X size={18} /> },
  { id: 'check', label: 'Check', icon: <Check size={18} /> },
  { id: 'signature', label: 'Sign', icon: <Signature size={18} /> },
];

/** What the size slider means, per annotation kind. */
const SIZE_RANGE: Partial<Record<AnnotationKind, { min: number; max: number; label: string }>> = {
  text: { min: 6, max: 72, label: 'Size' },
  pencil: { min: 0.5, max: 16, label: 'Stroke' },
  cross: { min: 6, max: 72, label: 'Size' },
  check: { min: 6, max: 72, label: 'Size' },
};

const KIND_LABEL: Record<AnnotationKind, string> = {
  text: 'Text',
  highlight: 'Highlight',
  pencil: 'Drawing',
  cross: 'Cross',
  check: 'Check',
  signature: 'Signature',
};

export default function AnnotationToolbar({
  tool,
  onToolChange,
  editingKind,
  hasSelection,
  color,
  onColorChange,
  size,
  onSizeChange,
  opacity,
  onOpacityChange,
  onEditStart,
  textFont,
  bold,
  italic,
  onTextStyleChange,
}: AnnotationToolbarProps) {
  const palette = editingKind === 'highlight' ? HIGHLIGHT_COLORS : INK_COLORS;
  const showColors = editingKind !== null && editingKind !== 'signature' && color !== null;
  const range = editingKind ? SIZE_RANGE[editingKind] : undefined;
  const showSize = range !== undefined && size !== null;
  const showOpacity = editingKind !== null && opacity !== null;
  const showText = editingKind === 'text';

  return (
    <div className="annotation-toolbar" role="toolbar" aria-label="Annotation tools">
      <div className="annotation-toolbar-row annotation-toolbar-tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`annotation-tool ${tool === t.id ? 'active' : ''}`}
            onClick={() => onToolChange(t.id)}
            aria-pressed={tool === t.id}
            title={t.label}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/*
        Always rendered, even with nothing to configure. The row used to mount
        and unmount as tools changed, shifting the page down by its own height
        mid-interaction.
      */}
      <div
        className={`annotation-toolbar-row annotation-toolbar-options ${
          hasSelection ? 'for-selection' : ''
        }`}
      >
        {editingKind && (
          <span className="annotation-options-scope">
            {hasSelection ? 'Selected' : 'New'} {KIND_LABEL[editingKind].toLowerCase()}
          </span>
        )}

        {showColors && (
          <div className="annotation-swatches" role="group" aria-label="Colour">
            {palette.map((c) => (
              <button
                key={c}
                className={`annotation-swatch ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => {
                  onEditStart();
                  onColorChange(c);
                }}
                aria-label={`Colour ${c}`}
                aria-pressed={color === c}
              />
            ))}
          </div>
        )}

        {showText && (
          <div className="annotation-group">
            <select
              className="annotation-font-select"
              aria-label="Font"
              value={textFont}
              onChange={(e) => {
                onEditStart();
                onTextStyleChange({ font: e.target.value as TextFont });
              }}
            >
              {TEXT_FONTS.map((f) => (
                <option key={f.id} value={f.id} style={{ fontFamily: f.css }}>
                  {f.label}
                </option>
              ))}
            </select>
            <button
              className={`annotation-style-btn ${bold ? 'active' : ''}`}
              aria-pressed={bold}
              aria-label="Bold"
              title="Bold"
              onClick={() => {
                onEditStart();
                onTextStyleChange({ bold: !bold });
              }}
            >
              <Bold size={15} />
            </button>
            <button
              className={`annotation-style-btn ${italic ? 'active' : ''}`}
              aria-pressed={italic}
              aria-label="Italic"
              title="Italic"
              onClick={() => {
                onEditStart();
                onTextStyleChange({ italic: !italic });
              }}
            >
              <Italic size={15} />
            </button>
          </div>
        )}

        {showSize && range && (
          <label className="annotation-field">
            <span>{range.label}</span>
            <input
              type="range"
              min={range.min}
              max={range.max}
              step={range.max <= 16 ? 0.5 : 1}
              value={Math.min(range.max, Math.max(range.min, size))}
              style={{ '--fill': `${((Math.min(range.max, Math.max(range.min, size)) - range.min) / (range.max - range.min)) * 100}%` } as React.CSSProperties}
              onPointerDown={onEditStart}
              onKeyDown={onEditStart}
              onChange={(e) => onSizeChange(Number(e.target.value))}
            />
            <output>{Math.round(size * 10) / 10}</output>
          </label>
        )}

        {showOpacity && (
          <label className="annotation-field">
            <span>Opacity</span>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={Math.round(opacity * 100)}
              style={{ '--fill': `${((Math.round(opacity * 100) - 5) / 95) * 100}%` } as React.CSSProperties}
              onPointerDown={onEditStart}
              onKeyDown={onEditStart}
              onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
            />
            <output>{Math.round(opacity * 100)}%</output>
          </label>
        )}

        {editingKind === 'signature' && !hasSelection && (
          <span className="annotation-options-hint">
            Click the page to place a signature
          </span>
        )}
        {hasSelection && (editingKind === 'signature' || editingKind === 'highlight') && (
          <span className="annotation-options-hint">Drag the corner to resize</span>
        )}
        {!editingKind && (
          <span className="annotation-options-hint">
            Pick a tool, or select a mark to change it
          </span>
        )}
      </div>
    </div>
  );
}
