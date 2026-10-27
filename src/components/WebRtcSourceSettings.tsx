import { useEffect, useState } from 'react';
import { FiRefreshCw } from 'react-icons/fi';
import './PanelSettings.css';
import { useRuntimeConfig } from '../runtime/runtimeConfig';
import { enterpriseFetch } from '../features/enterprise/session';
import { readSignalingText, type WebRtcOptions } from '../utils/images/webrtcStreams';

export default function WebRtcSourceSettings({
  value,
  onChange,
}: {
  value: WebRtcOptions;
  onChange: (patch: WebRtcOptions) => void;
}) {
  const { webrtcWhepBaseUrl, webrtcDiscoveryUrl } = useRuntimeConfig();
  const [paths, setPaths] = useState<string[]>([]),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void enterpriseFetch(webrtcDiscoveryUrl, { signal: abort.signal, redirect: 'error', cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(`Stream discovery returned HTTP ${response.status}.`);
        const text = await readSignalingText(response);
        if (text.length > 256 * 1024) throw new Error('Stream discovery exceeds its size limit.');
        const data = JSON.parse(text);
        const names = (Array.isArray(data.items) ? data.items : [])
          .filter(
            (item: any) =>
              item?.ready === true &&
              typeof item.name === 'string' &&
              item.name.length <= 256 &&
              item.name.split('/').every((part: string) => /^[a-z0-9_-]+$/i.test(part))
          )
          .slice(0, 100)
          .map((item: any) => item.name as string);
        if (!abort.signal.aborted) {
          setPaths(names);
          setError('');
        }
      })
      .catch(cause => {
        if (!abort.signal.aborted)
          setError(`${cause instanceof Error ? cause.message : 'Discovery unavailable.'} Enter a WHEP URL directly.`);
      });
    return () => abort.abort();
  }, [webrtcDiscoveryUrl, revision]);
  const text = (label: string, field: keyof WebRtcOptions, placeholder = '') => (
    <label className="panel-settings-field">
      <span>{label}</span>
      <input
        key={String(value[field] ?? '')}
        aria-label={label}
        defaultValue={String(value[field] ?? '')}
        placeholder={placeholder}
        onBlur={event => onChange({ [field]: event.currentTarget.value.trim() })}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
  return (
    <div className="webrtc-source-settings panel-settings">
      <label className="panel-settings-field">
        <span>Available WebRTC streams</span>
        <select
          aria-label="Available WebRTC streams"
          value=""
          onChange={event => {
            const name = event.target.value;
            if (name)
              onChange({
                whepUrl: new URL(
                  `${name.split('/').map(encodeURIComponent).join('/')}/whep`,
                  new URL(webrtcWhepBaseUrl.endsWith('/') ? webrtcWhepBaseUrl : `${webrtcWhepBaseUrl}/`, location.href)
                ).href,
              });
          }}
        >
          <option value="">Choose a stream</option>
          {paths.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <button className="panel-settings-action" type="button" onClick={() => setRevision(v => v + 1)}>
        <FiRefreshCw aria-hidden="true" />
        <span>Refresh WebRTC streams</span>
      </button>
      {error && (
        <p className="panel-settings-status" role="status">
          {error}
        </p>
      )}
      {text('WHEP URL', 'whepUrl', 'https://camera.example/stream/whep')}
    </div>
  );
}
