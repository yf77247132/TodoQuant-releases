
interface SwitchProps {
  label?: string;
  descriptionOn?: string;
  descriptionOff?: string;
  description?: string;
  colorOff?: string;
  colorOn?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export default function Switch({
  label,
  descriptionOn,
  descriptionOff,
  description,
  colorOff,
  colorOn,
  checked,
  onChange,
  className = '',
  size = 'md'
}: SwitchProps) {
  const isBgClass = (c?: string) => c?.startsWith('bg-');
  const isTextClass = (c?: string) => c?.startsWith('text-');

  const finalBgOn = isBgClass(colorOn) ? colorOn : 'bg-brand-yellow';
  const finalBgOff = isBgClass(colorOff) ? colorOff : 'bg-surface-3';

  const finalTextColorOn = isTextClass(colorOn) ? colorOn : 'text-text-tertiary';
  const finalTextColorOff = isTextClass(colorOff) ? colorOff : 'text-text-tertiary';

  const sizeClasses = size === 'sm'
    ? 'h-5 w-9'
    : 'h-6 w-11';

  const dotSizeClasses = size === 'sm'
    ? 'h-4 w-4'
    : 'h-5 w-5';

  const dotTranslateClasses = size === 'sm'
    ? (checked ? 'translate-x-4' : 'translate-x-0')
    : (checked ? 'translate-x-5' : 'translate-x-0');

  const content = (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex ${sizeClasses} flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        checked ? finalBgOn : finalBgOff
      }`}
    >
      <span
        className={`pointer-events-none inline-block ${dotSizeClasses} transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${dotTranslateClasses}`}
      />
    </button>
  );

  if (!label && !description && !descriptionOn && !descriptionOff) {
    return content;
  }

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <div className="space-y-0.5">
        {label && <label className="text-2xs font-bold text-text-tertiary uppercase tracking-wider flex items-center gap-1.5">{label}</label>}
        {(descriptionOn || descriptionOff || description) && (
          <p className={`text-xs ${checked ? finalTextColorOn : finalTextColorOff}`}>
            {description || (checked ? descriptionOn : descriptionOff)}
          </p>
        )}
      </div>
      {content}
    </div>
  );
}
