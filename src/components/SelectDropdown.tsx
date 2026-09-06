import { useEffect, useRef, useState } from 'react';
import { IconRenderer } from './Icons';

export interface SelectDropdownOption {
  value: string;
  label: string;
}

interface SelectDropdownProps {
  options: SelectDropdownOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  containerClassName?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export function SelectDropdown({
  options,
  value,
  onChange,
  className = '',
  containerClassName = 'w-full',
  placeholder,
  ariaLabel,
  disabled = false,
}: SelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find(option => option.value === value);
  const displayLabel = selectedOption?.label || placeholder || '';

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div ref={dropdownRef} className={`relative ${containerClassName}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(open => !open)}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={`w-full flex items-center justify-between gap-3 text-left ${className} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <span className={!selectedOption ? 'text-slate-400' : ''}>{displayLabel}</span>
        <IconRenderer name={isOpen ? 'chevron-up' : 'chevron-down'} className="w-4 h-4 shrink-0 text-slate-500" />
      </button>

      {isOpen && !disabled && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute top-full left-0 right-0 mt-2 z-[2100] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl max-h-64 overflow-y-auto"
        >
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full px-3 py-2.5 rounded-lg flex items-center justify-between gap-3 text-left text-sm font-semibold transition-colors ${
                value === option.value ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50 hover:text-navy'
              }`}
            >
              <span>{option.label}</span>
              {value === option.value && <IconRenderer name="check" className="w-4 h-4 shrink-0 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
