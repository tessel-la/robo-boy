import { companyBranded } from '../features/enterprise/config';
import './RoboBoyAttribution.css';

export default function RoboBoyAttribution({ className = '' }: { className?: string }) {
  if (!companyBranded) return null;
  return (
    <span className={`robo-boy-attribution ${className}`}>
      Powered by <strong>robo-boy</strong>
    </span>
  );
}
