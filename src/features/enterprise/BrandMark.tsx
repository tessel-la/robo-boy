import { brand } from './config';
export default function BrandMark() {
  return (
    <div className="enterprise-brand">
      {brand.logo && <img src={brand.logo} alt="" width="64" height="64" />}
      <span>{brand.name}</span>
    </div>
  );
}
