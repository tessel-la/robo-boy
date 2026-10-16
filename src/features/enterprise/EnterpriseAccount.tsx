import { useEnterpriseAccount } from './EnterpriseBoundary';
import BrandMark from './BrandMark';
/** Account controls live in the existing connection menu, without another workspace header. */
export default function EnterpriseAccount() {
  const account = useEnterpriseAccount();
  if (!account) return null;
  return (
    <div className="enterprise-menu-account">
      <BrandMark />
      <span>{account.user.name}</span>
      <button className="connection-switcher-tool" type="button" onClick={() => void account.logout()}>
        Sign out
      </button>
    </div>
  );
}
