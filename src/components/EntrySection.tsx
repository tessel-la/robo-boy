import React, { useState } from 'react';
import { ConnectionParams } from '../App'; // Adjust if ConnectionParams definition changes
import './EntrySection.css';

interface EntrySectionProps {
  onConnect: (params: ConnectionParams) => void;
}

const EntrySection: React.FC<EntrySectionProps> = ({ onConnect }) => {
  const [ros2Option, setRos2Option] = useState<'domain' | 'ip'>('domain');
  const [ros2Value, setRos2Value] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params: ConnectionParams = {
      ros2Option,
      ros2Value: ros2Option === 'domain' ? parseInt(ros2Value, 10) || 0 : ros2Value,
    };
    onConnect(params);
  };

  return (
    <div className="entry-section card">
      <h2>Connect to Robot (ROS 2)</h2>
      <form onSubmit={handleSubmit}>
        <>
          <div className="form-group">
            <label>ROS 2 Connection Method:</label>
            <div className="radio-group">
              <label>
                <input
                  type="radio"
                  value="domain"
                  checked={ros2Option === 'domain'}
                  onChange={() => setRos2Option('domain')}
                />
                Domain ID
              </label>
              <label>
                <input
                  type="radio"
                  value="ip"
                  checked={ros2Option === 'ip'}
                  onChange={() => setRos2Option('ip')}
                />
                IP Address
              </label>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="ros2Value">
              {ros2Option === 'domain' ? 'Domain ID:' : 'IP Address:'}
            </label>
            <input
              type={ros2Option === 'domain' ? 'number' : 'text'}
              id="ros2Value"
              value={ros2Value}
              onChange={(e) => setRos2Value(e.target.value)}
              placeholder={ros2Option === 'domain' ? 'e.g., 0' : 'e.g., 192.168.1.100'}
              required
            />
          </div>
        </>

        <button type="submit">Connect</button>
      </form>
    </div>
  );
};

export default EntrySection; 