
import { memo, useState } from 'react';

interface CoinIconProps {
  symbol?: string;
  size?: number;
  className?: string;
}

function FallbackIcon({ symbol, size }: { symbol?: string; size: number }) {
  const letter = symbol ? symbol.charAt(0).toUpperCase() : '?';
  return (
    <div
      className="rounded-full bg-surface-3 flex items-center justify-center text-text-tertiary font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {letter}
    </div>
  );
}

const CoinIcon: React.FC<CoinIconProps> = memo(({ symbol, size = 18, className }) => {
  const upperSymbol = symbol?.trim().toUpperCase() || '';
  const [imgError, setImgError] = useState(false);

  if (!upperSymbol || imgError) {
    return <FallbackIcon symbol={symbol} size={size} />;
  }

  return (
    <img
      src={`/crypto-icons/${upperSymbol}.svg`}
      alt={upperSymbol}
      width={size}
      height={size}
      className={`rounded-full shrink-0 ${className || ''}`}
      onError={() => setImgError(true)}
    />
  );
});

CoinIcon.displayName = 'CoinIcon';

export default CoinIcon;
