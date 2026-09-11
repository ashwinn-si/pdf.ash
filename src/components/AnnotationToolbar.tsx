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
  /** Called as a slider drag or swatch click begins, to snapshot for undo. */
  onEditStart: () => void;
  /** Text styling — shown only while text is the kind being edited. */
  textFont: TextFont;
  bold: boolean;
  italic: boolean;
  onTextStyleChange: (style: { font?: TextFont; bold?: boolean; italic?: boolean }) => void;
}

const TOOLS: { id: EditorTool; label: string; icon: React.ReactNode }[] = [
  { id: 'select', label: 'Select', icon: <MousePointer2 size={20} /> },
  { id: 'text', label: 'Add Text', icon: <Type size={20} /> },
  { id: 'highlight', label: 'Highlight', icon: <Highlighter size={20} /> },
  { id: 'pencil', label: 'Pencil', icon: <Pencil size={20} /> },
  { id: 'cross', label: 'Cross', icon: <X size={20} /> },
  { id: 'check', label: 'Check', icon: <Check size={20} /> },
  { id: 'signature', label: 'Sign', icon: <Signature size={20} /> },
];

/** What the size slider means, per annotation kind. */
const SIZE_RANGE: Partial<Record<AnnotationKind, { min: number; max: number; label: string }>> = {
  text: { min: 6, max: 72, label: 'Text size' },
  pencil: { min: 0.5, max: 16, label: 'Stroke' },
  cross: { min: 6, max: 72, label: 'Mark size' },
  check: { min: 6, max: 72, label: 'Mark size' },
};

const KIND_LABEL: Record<AnnotationKind, string> = {
  text: 'text',
  highlight: 'highlight',
  pencil: 'drawing',
  cross: 'cross',
  check: 'check',
  signature: 'signature',
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
  // A signature or highlight is sized by dragging its corner, not by a slider.
  const handleOnly = hasSelection && !showSize;
  const showText = editingKind === 'text';

  return (
    <div className="annotation-toolbar" role="toolbar" aria-label="Annotation tools">
      <div className="annotation-toolbar-tools">
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

      {(showColors || showSize || handleOnly || showText) && (
        <div className={`annotation-toolbar-options ${hasSelection ? 'for-selection' : ''}`}>
          {hasSelection && editingKind && (
            <span className="annotation-options-scope">
              Selected {KIND_LABEL[editingKind]}
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
            <div className="annotation-textstyle">
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
            <label className="annotation-size">
              <span>{range.label}</span>
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.max <= 16 ? 0.5 : 1}
                value={Math.min(range.max, Math.max(range.min, size))}
                onPointerDown={onEditStart}
                onKeyDown={onEditStart}
                onChange={(e) => onSizeChange(Number(e.target.value))}
              />
              <output>{Math.round(size * 10) / 10}</output>
            </label>
          )}

          {handleOnly && (
            <span className="annotation-options-hint">
              Drag the corner handle to resize
            </span>
          )}
        </div>
      )}
    </div>
  );
}
