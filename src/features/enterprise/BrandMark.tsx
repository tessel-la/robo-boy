import { brand } from './config';
export default function BrandMark() {
  return (
    <div className={`enterprise-brand ${brand.logoWordmark ? 'is-wordmark' : ''}`}>
      {brand.logo && <img src={brand.logo} alt={brand.logoWordmark ? brand.name : ''} />}
      <span className={brand.logoWordmark ? 'sr-only' : undefined}>{brand.name}</span>
    </div>
  );
}
