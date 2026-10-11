import React from 'react';
import {
  Scissors,
  Minimize2,
  FileText,
  ArrowRightLeft,
  PanelLeftClose,
  PanelLeft,
  Layers,
  LockOpen,
  PenTool,
  ShieldCheck,
  Stamp,
} from 'lucide-react';

export type Tool = 'merge' | 'edit' | 'split' | 'compress' | 'convert' | 'unlock' | 'verify' | 'stamp';

interface SidebarProps {
  activeTool: Tool;
  onSelectTool: (tool: Tool) => void;
  pageCount: number;
  isOpen: boolean;
  onToggle: () => void;
}

interface ToolDef {
  id: Tool;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const toolGroups: { label: string; tools: ToolDef[] }[] = [
  {
    label: 'Organize',
    tools: [
      { id: 'merge', label: 'Merge & Arrange', icon: <Layers size={18} />, description: 'Combine PDFs, images and Markdown, then reorder, rotate or delete pages' },
      { id: 'split', label: 'Split', icon: <Scissors size={18} />, description: 'Split into parts' },
    ],
  },
  {
    label: 'Edit',
    tools: [
      { id: 'edit', label: 'Edit', icon: <PenTool size={18} />, description: 'Sign & annotate pages' },
      { id: 'stamp', label: 'Watermark', icon: <Stamp size={18} />, description: 'Add a watermark and page numbers' },
    ],
  },
  {
    label: 'Optimize & convert',
    tools: [
      { id: 'compress', label: 'Compress', icon: <Minimize2 size={18} />, description: 'Reduce file size' },
      { id: 'convert', label: 'Convert', icon: <ArrowRightLeft size={18} />, description: 'Convert to other formats' },
    ],
  },
  {
    label: 'Security',
    tools: [
      { id: 'unlock', label: 'Unlock', icon: <LockOpen size={18} />, description: 'Remove password from PDF' },
      { id: 'verify', label: 'Verify', icon: <ShieldCheck size={18} />, description: 'Check a PDF’s digital signatures' },
    ],
  },
];

export default function Sidebar({ activeTool, onSelectTool, pageCount, isOpen, onToggle }: SidebarProps) {
  return (
    <aside className={`sidebar ${!isOpen ? 'collapsed' : ''}`}>
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <FileText size={20} />
        </div>
        <div className="sidebar-logo-text">
          <h1>pdf.ash</h1>
          <span>All-in-one editor</span>
        </div>
        <button
          className="sidebar-toggle-btn"
          onClick={onToggle}
          title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-label={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={isOpen}
        >
          {isOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>
      </div>

      <nav className="sidebar-section" aria-label="Tools">
        {toolGroups.map((group) => (
          <div className="sidebar-group" key={group.label}>
            <div className="sidebar-section-label">{group.label}</div>
            {group.tools.map((tool) => (
              <button
                key={tool.id}
                className={`sidebar-tool ${activeTool === tool.id ? 'active' : ''}`}
                onClick={() => onSelectTool(activeTool === tool.id ? 'merge' : tool.id)}
                title={tool.description}
                aria-current={activeTool === tool.id ? 'true' : undefined}
              >
                <span className="sidebar-tool-icon">{tool.icon}</span>
                <span>{tool.label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      {pageCount > 0 && (
        <div className="sidebar-page-count">
          <div className="sidebar-page-label">
            Pages
          </div>
          <div className="sidebar-page-number">
            {pageCount}
          </div>
        </div>
      )}
      <div className="sidebar-footer">
        {isOpen ? (
          <p>
            Built by <a href="https://github.com/ashwinn-si" target="_blank" rel="noopener noreferrer">Ashwin S I</a>
          </p>
        ) : (
          <a href="https://github.com/ashwinn-si" target="_blank" rel="noopener noreferrer" title="Built by ashwinsi">
            <div className="sidebar-dev-icon">@</div>
          </a>
        )}
      </div>
    </aside>
  );
}
