import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange
}: PaginationProps) {
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const handlePrev = () => {
    if (currentPage > 1) onPageChange(currentPage - 1);
  };

  const handleNext = () => {
    if (currentPage < totalPages) onPageChange(currentPage + 1);
  };

  return (
    <div className="pagination-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderTop: '1px solid var(--border-color)', background: 'var(--glass-bg)', flexWrap: 'wrap', gap: '14px' }}>
      <div className="pagination-info" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
        Showing <strong style={{ color: 'var(--text-primary)' }}>{totalItems === 0 ? 0 : startItem}</strong> to <strong style={{ color: 'var(--text-primary)' }}>{endItem}</strong> of <strong style={{ color: 'var(--text-primary)' }}>{totalItems}</strong> entries
      </div>
      
      <div className="pagination-controls" style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        <div className="page-size-selector" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          <span>Rows per page:</span>
          <select 
            value={pageSize} 
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value));
              onPageChange(1); // Reset to page 1 on resize
            }}
            className="form-input"
            style={{ padding: '4px 10px', height: 'auto', width: 'auto', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>

        <div className="page-navigation" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button 
            className="btn btn-secondary icon-btn" 
            onClick={handlePrev} 
            disabled={currentPage === 1}
            style={{ padding: '6px 8px', borderRadius: '6px' }}
            title="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          
          <span className="page-number" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', minWidth: '90px', textAlign: 'center', background: 'var(--bg-tertiary)', padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            {currentPage} / {totalPages}
          </span>
          
          <button 
            className="btn btn-secondary icon-btn" 
            onClick={handleNext} 
            disabled={currentPage === totalPages}
            style={{ padding: '6px 8px', borderRadius: '6px' }}
            title="Next page"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
