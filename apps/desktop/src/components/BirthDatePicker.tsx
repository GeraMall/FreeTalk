import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface BirthDateOption {
  value: string;
  label: string;
}

const menuHeight = 192;
const menuGap = 6;

type ChoicePickerProps = {
  label: string;
  value: string;
  options: BirthDateOption[];
  onChange(value: string): void;
  required?: boolean;
  className?: string;
};

export function ChoicePicker({
  label,
  value,
  options,
  onChange,
  required = false,
  className = '',
}: ChoicePickerProps) {
  const listId = useId();
  const field = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', time: 0 });
  const [menu, setMenu] = useState<{ above: boolean; height: number }>();
  const [active, setActive] = useState(0);
  const selected = options.findIndex((option) => option.value === value);
  const open = menu !== undefined;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!field.current?.contains(event.target as Node)) setMenu(undefined);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  useEffect(() => {
    const popup = list.current;
    const option = popup?.children[active] as HTMLElement | undefined;
    if (!open || !popup || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < popup.scrollTop) popup.scrollTop = top;
    else if (bottom > popup.scrollTop + popup.clientHeight)
      popup.scrollTop = bottom - popup.clientHeight;
  }, [active, open]);

  function show(trigger: HTMLButtonElement, initial = Math.max(0, selected)) {
    const bounds = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const frame = trigger
      .closest('.account-welcome, .browser-platform-gate, .native-screen-picker, .settings-content')
      ?.getBoundingClientRect();
    const top = Math.max(viewport?.offsetTop ?? 0, frame?.top ?? 0);
    const bottom = Math.min(
      viewport ? viewport.offsetTop + viewport.height : window.innerHeight,
      frame?.bottom ?? window.innerHeight,
    );
    const above = bounds.top - top - menuGap;
    const below = bottom - bounds.bottom - menuGap;
    const desiredHeight = Math.min(menuHeight, options.length * 40 + 16);
    const useAbove = below < desiredHeight && above > below;
    setActive(initial);
    setMenu({
      above: useAbove,
      height: Math.max(0, Math.min(desiredHeight, useAbove ? above : below)),
    });
    typed.current.text = '';
  }

  function select(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setMenu(undefined);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const { key } = event;
    if (key === 'Tab' && open) {
      setMenu(undefined);
    } else if (key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setMenu(undefined);
    } else if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      event.preventDefault();
      const last = options.length - 1;
      const next =
        key === 'Home'
          ? 0
          : key === 'End'
            ? last
            : key === 'ArrowDown'
              ? Math.min(last, (open ? active : selected) + 1)
              : Math.max(0, (open ? active : selected === -1 ? last + 1 : selected) - 1);
      if (open) setActive(next);
      else show(event.currentTarget, next);
    } else if (open && (key === 'Enter' || key === ' ')) {
      event.preventDefault();
      select(active);
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[\p{L}\p{N}]$/u.test(key)) {
      event.preventDefault();
      if (!open) show(event.currentTarget);
      const prefix =
        (open && event.timeStamp - typed.current.time < 700 ? typed.current.text : '') + key;
      typed.current = { text: prefix, time: event.timeStamp };
      const match = options.findIndex((option) =>
        option.label.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()),
      );
      if (match >= 0) setActive(match);
    }
  }

  return (
    <div className={`birth-date-picker ${className}`} ref={field}>
      <button
        type="button"
        className="birth-date-trigger"
        role="combobox"
        aria-label={label}
        aria-required={required || undefined}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={(event) => {
          if (open) setMenu(undefined);
          else show(event.currentTarget);
        }}
        onBlur={(event) => {
          if (event.relatedTarget && !field.current?.contains(event.relatedTarget))
            setMenu(undefined);
        }}
        onKeyDown={keyDown}
      >
        <span>{options[selected]?.label ?? label}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {menu && (
        <div
          className={`history-period-options birth-date-options${menu.above ? ' above' : ''}`}
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label}
          style={{ maxHeight: menu.height }}
        >
          {options.map((option, index) => (
            <button
              type="button"
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === selected}
              className={index === active ? 'active' : undefined}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(index)}
            >
              <span>{option.label}</span>
              {index === selected && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function BirthDatePicker(props: ChoicePickerProps) {
  return <ChoicePicker {...props} required />;
}
