import React from 'react';
import {
  Scissors,
  Minimize2,
  FileText,
  ArrowRightLeft,
  ImagePlus,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';

export type Tool = 'merge' | 'rearrange' | 'split' | 'compress' | 'convert' | 'imageToPdf';

interface SidebarProps {
  activeTool: Tool;
  onSelectTool: (tool: Tool) => void;
  pageCount: number;
  isOpen: boolean;
  onToggle: () => void;
}

const tools: { id: Tool; label: string; icon: React.ReactNode; description: string }[] = [
  { id: 'split', label: 'Split', icon: <Scissors size={18} />, description: 'Split into parts' },
  { id: 'compress', label: 'Compress', icon: <Minimize2 size={18} />, description: 'Reduce file size' },
  { id: 'convert', label: 'Convert', icon: <ArrowRightLeft size={18} />, description: 'Convert to other formats' },
  { id: 'imageToPdf', label: 'Image to PDF', icon: <ImagePlus size={18} />, description: 'Convert images to PDF' },
];

export default function Sidebar({ activeTool, onSelectTool, pageCount, isOpen, onToggle }: SidebarProps) {
  return (
    <aside className={`sidebar ${!isOpen ? 'collapsed' : ''}`}>
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <FileText size={20} />
        </div>
        <div className="sidebar-logo-text">
          <h1>PDF Studio</h1>
          <span>All-in-one editor</span>
        </div>
      </div>

      <nav className="sidebar-section">
        <div className="sidebar-section-label">Tools</div>
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`sidebar-tool ${activeTool === tool.id ? 'active' : ''}`}
            onClick={() => onSelectTool(activeTool === tool.id ? 'rearrange' : tool.id)}
            title={tool.description}
          >
            <span className="sidebar-tool-icon">{tool.icon}</span>
            <span>{tool.label}</span>
          </button>
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

      <button className="sidebar-toggle-btn" onClick={onToggle} title={isOpen ? "Collapse Sidebar" : "Expand Sidebar"}>
        {isOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        {isOpen && <span>Collapse</span>}
      </button>
    </aside>
  );
}
