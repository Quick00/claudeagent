'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface DialogOverlayProps {
  onClose: () => void;
  title: string;
  wide?: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

export default function DialogOverlay({ onClose, title, wide, headerRight, children }: DialogOverlayProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 150);
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-colors duration-150 ${visible ? 'bg-black/50' : 'bg-black/0'}`}
      onClick={handleClose}
    >
      <div
        className={`${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[85vh] w-full overflow-y-auto rounded-lg bg-white p-6 shadow-xl transition-all duration-150 dark:bg-gray-900 ${visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <div className="flex items-center gap-2">
            {headerRight}
            <button onClick={handleClose} className="ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">&times;</button>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
