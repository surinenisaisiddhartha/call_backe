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
    <div className="pagination-container">
      <div className="pagination-info">
        Showing <strong>{totalItems === 0 ? 0 : startItem}</strong> to <strong>{endItem}</strong> of <strong>{totalItems}</strong> entries
      </div>
      
      <div className="pagination-controls">
        <div className="page-size-selector">
          <label>Rows per page:</label>
          <select 
            value={pageSize} 
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value));
              onPageChange(1); // Reset to page 1 on resize
            }}
            className="form-input"
            style={{ padding: '4px 8px', height: 'auto', width: 'auto' }}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>

        <div className="page-navigation">
          <button 
            className="btn btn-secondary icon-btn" 
            onClick={handlePrev} 
            disabled={currentPage === 1}
            style={{ padding: '6px' }}
          >
            <ChevronLeft size={18} />
          </button>
          
          <span className="page-number">Page {currentPage} of {totalPages}</span>
          
          <button 
            className="btn btn-secondary icon-btn" 
            onClick={handleNext} 
            disabled={currentPage === totalPages}
            style={{ padding: '6px' }}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
