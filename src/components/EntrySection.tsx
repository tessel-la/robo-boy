import React, { useState, useEffect, useRef } from 'react';
import { ConnectionParams } from '../App'; // Adjust if ConnectionParams definition changes
import './EntrySection.css';
import anime from 'animejs';
import { animateLandingPage, animateAdvancedForm, animateButtonPress } from '../utils/animations';
import {
  getDefaultConnectionHost,
  getDefaultServicePorts,
  normalizeRuntimeServicePorts,
  type RuntimeServicePorts,
} from '../runtime/runtimeConfig';
import {
  loadRecentConnections,
  RecentConnection,
  removeRecentConnection,
} from '../runtime/recentConnections';

interface EntrySectionProps {
  onConnect: (params: ConnectionParams) => void;
}

type PortKey = keyof RuntimeServicePorts;

// Simple gear icon component for the advanced options
const GearIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
);

const TrashIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v5" />
    <path d="M14 11v5" />
  </svg>
);

// Dropdown caret icon component (kept for potential future use)
const _CaretIcon = ({ isOpen }: { isOpen: boolean }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.3s ease' }}
  >
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
);

const EntrySection: React.FC<EntrySectionProps> = ({ onConnect }) => {
  const [ros2Option, setRos2Option] = useState<'domain' | 'ip'>('ip');
  const [ros2Value, setRos2Value] = useState<string>('');
  const [servicePorts, setServicePorts] = useState<RuntimeServicePorts>(() => getDefaultServicePorts());
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [recentConnections, setRecentConnections] = useState<RecentConnection[]>(() => loadRecentConnections());

  // Where Quick Connect goes: the host the page was served from in a browser, and in the packaged
  // app the last one that worked. A packaged app on its first launch has neither, so there is
  // nothing to connect quickly to and the form that asks for a host is the screen itself.
  const currentHostname = getDefaultConnectionHost() || recentConnections[0]?.host || '';
  const needsConnectionTarget = !currentHostname;

  const [showAdvanced, setShowAdvanced] = useState(needsConnectionTarget);
  const logoRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const quickConnectRef = useRef<HTMLButtonElement>(null);
  const dashRef = useRef<HTMLSpanElement>(null);
  const transitionOverlayRef = useRef<HTMLDivElement>(null);
  // Track theme changes
  const [themeColors, setThemeColors] = useState({
    primary: '',
    hover: '',
  });

  const defaultServicePorts = getDefaultServicePorts();

  const normalizeSelectedPorts = (ports = servicePorts): RuntimeServicePorts => {
    return normalizeRuntimeServicePorts(ports, defaultServicePorts);
  };

  const updateServicePort = (key: PortKey, value: string) => {
    setServicePorts(ports => ({ ...ports, [key]: value }));
  };

  const normalizeServicePort = (key: PortKey) => {
    setServicePorts(ports => normalizeSelectedPorts({ ...ports, [key]: ports[key] }));
  };

  // Watch for theme changes
  useEffect(() => {
    const checkTheme = () => {
      const style = getComputedStyle(document.documentElement);
      const primary = style.getPropertyValue('--primary-color').trim();
      const hover = style.getPropertyValue('--primary-hover-color').trim();

      if (primary !== themeColors.primary || hover !== themeColors.hover) {
        setThemeColors({
          primary,
          hover,
        });
      }
    };

    // Initial check
    checkTheme();

    // Set up observer to watch for theme changes (attribute changes)
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, [themeColors.primary, themeColors.hover]);

  // Initialize anime.js animation when component mounts
  useEffect(() => {
    // Animate the entry elements when component mounts
    animateLandingPage(containerRef.current, logoRef.current);
  }, []);

  // Handle advanced form animation when its visibility changes
  useEffect(() => {
    animateAdvancedForm(formRef.current, showAdvanced);

    // Animate gear icon rotation
    const gearIcon = document.querySelector('.advanced-toggle-content svg') as HTMLElement | null;
    if (gearIcon) {
      anime({
        targets: gearIcon as HTMLElement,
        rotate: showAdvanced ? 180 : 0,
        duration: 500,
        easing: 'easeInOutQuad',
      });
    }
  }, [showAdvanced]);

  // Helper function to convert hex to rgb (kept for potential future use)
  const _hexToRgb = (hex: string): string => {
    // Default fallback in case of parsing issues
    if (!hex || !hex.startsWith('#')) return '50, 205, 50';

    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    const fullHex = hex.replace(shorthandRegex, (_m, r, g, b) => r + r + g + g + b + b);

    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
    if (!result) return '50, 205, 50';

    const r = parseInt(result[1], 16);
    const g = parseInt(result[2], 16);
    const b = parseInt(result[3], 16);

    return `${r}, ${g}, ${b}`;
  };

  // Animate the dash character - re-run animation when theme changes
  useEffect(() => {
    if (!dashRef.current) return;

    // Get theme colors for animation
    const style = getComputedStyle(document.documentElement);
    const _primaryColor = style.getPropertyValue('--primary-color').trim();
    const _hoverColor = style.getPropertyValue('--primary-hover-color').trim();

    // Clear any inline styles
    dashRef.current.style.removeProperty('color');

    // Timeline for sequenced animations
    const dashTimeline = anime.timeline({
      loop: true,
      direction: 'alternate',
      easing: 'easeInOutSine',
    });

    // Add wiggle/rotation animation
    dashTimeline
      .add({
        targets: dashRef.current,
        rotate: [
          { value: -15, duration: 400, easing: 'easeInOutBack' },
          { value: 15, duration: 600, easing: 'easeInOutBack' },
          { value: -8, duration: 300, easing: 'easeInOutBack' },
          { value: 8, duration: 400, easing: 'easeInOutBack' },
          { value: 0, duration: 500, easing: 'easeInOutBack' },
        ] as any,
        duration: 2200,
      })
      .add({
        targets: dashRef.current,
        translateY: [
          { value: -4, duration: 300, easing: 'easeOutExpo' },
          { value: 0, duration: 600, easing: 'easeInElastic' },
        ] as any,
        scale: [
          { value: 1.2, duration: 300, easing: 'easeOutExpo' },
          { value: 1, duration: 600, easing: 'easeInElastic' },
        ] as any,
        duration: 900,
        offset: '-=1000', // Start before previous animation ends
      });

    return () => {
      dashTimeline.pause();
    };
  }, [themeColors]); // Re-run when theme colors change

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Animate the submit button on press
    if (e.currentTarget && e.currentTarget instanceof HTMLFormElement) {
      const submitButton = e.currentTarget.querySelector('button[type="submit"]');
      if (submitButton) {
        animateButtonPress(submitButton as HTMLElement);
      }
    }

    const selectedPorts = normalizeSelectedPorts();
    const params: ConnectionParams = {
      ros2Option,
      ros2Value: ros2Option === 'domain' ? parseInt(ros2Value, 10) || 0 : ros2Value,
      ...selectedPorts,
    };
    onConnect(params);
  };

  const handleQuickConnect = () => {
    if (isTransitioning) return;

    setIsTransitioning(true);
    const button = quickConnectRef.current;
    if (!button) return;

    const buttonRect = button.getBoundingClientRect();
    const overlay = transitionOverlayRef.current;
    if (!overlay) return;

    // Get the button's position relative to the viewport
    const buttonCenterX = buttonRect.left + buttonRect.width / 2;
    const buttonCenterY = buttonRect.top + buttonRect.height / 2;

    // Hide button immediately
    button.style.opacity = '0';
    button.style.pointerEvents = 'none';

    // Set initial position of the overlay
    overlay.style.left = `${buttonCenterX}px`;
    overlay.style.top = `${buttonCenterY}px`;
    overlay.style.width = `${buttonRect.width}px`;
    overlay.style.height = `${buttonRect.height}px`;
    overlay.style.borderRadius = '4px';
    overlay.style.display = 'block';

    // Create a timeline for the animation sequence
    const timeline = anime.timeline({
      easing: 'easeInOutQuad',
      complete: () => {
        // Call onConnect after animation completes
        const selectedPorts = normalizeSelectedPorts();
        const params: ConnectionParams = {
          ros2Option: 'ip',
          ros2Value: currentHostname,
          ...selectedPorts,
        };
        onConnect(params);
      },
    });

    // First shrink to a dot
    timeline
      .add({
        targets: overlay,
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        duration: 300,
      })
      // Then drop to bottom of screen
      .add({
        targets: overlay,
        top: `${window.innerHeight - 10}px`,
        duration: 500,
        easing: 'easeInQuad',
      })
      // Finally expand to fill screen
      .add({
        targets: overlay,
        width: '200vmax',
        height: '200vmax',
        duration: 600,
        easing: 'easeOutQuad',
      });
  };

  const handleRecentConnect = (connection: RecentConnection) => {
    if (isTransitioning) return;
    const selectedPorts = normalizeRuntimeServicePorts(connection, defaultServicePorts);
    onConnect({
      ros2Option: 'ip',
      ros2Value: connection.host,
      ...selectedPorts,
    });
  };

  const handleRemoveRecentConnection = (event: React.MouseEvent, connection: RecentConnection) => {
    event.stopPropagation();
    setRecentConnections(removeRecentConnection(connection.host));
  };

  const toggleAdvanced = () => {
    setShowAdvanced(!showAdvanced);
  };

  return (
    <div className="entry-section-container" ref={containerRef}>
      <div className="entry-section card" data-testid="entry-section">
        <div className="logo-container" ref={logoRef}>
          <h1 className="app-title">
            <span className="title-robo">Robo</span>
            <span className="title-dash" ref={dashRef}>
              -
            </span>
            <span className="title-boy">Boy</span>
          </h1>
        </div>

        <div className="connection-options">
          {needsConnectionTarget ? (
            <p className="connection-prompt">
              Enter the address of the computer running the ROS stack. It is remembered for next time.
            </p>
          ) : (
            <>
              <button
                className="quick-connect-btn"
                onClick={handleQuickConnect}
                title={`Connect to ${currentHostname}`}
                ref={quickConnectRef}
                style={{
                  position: 'relative',
                  transition: 'opacity 0.1s ease',
                }}
                disabled={isTransitioning}
              >
                Quick Connect
                <span className="quick-connect-ip">{currentHostname}</span>
              </button>

              {/* Nothing to collapse back to while the form is the only way to connect. */}
              <button
                type="button"
                className="advanced-toggle"
                onClick={toggleAdvanced}
                title="Advanced Options"
                style={{
                  padding: '12px 16px',
                  minWidth: '48px',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <span className="advanced-toggle-content">
                  <GearIcon />
                </span>
              </button>
            </>
          )}

          <form onSubmit={handleSubmit} ref={formRef} className={`advanced-form ${showAdvanced ? 'visible' : ''}`}>
            <div className="form-group">
              <label>Connection Method:</label>
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
                  <input type="radio" value="ip" checked={ros2Option === 'ip'} onChange={() => setRos2Option('ip')} />
                  Host or IP
                </label>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="ros2Value">{ros2Option === 'domain' ? 'Domain ID:' : 'Host or IP:'}</label>
              <input
                type={ros2Option === 'domain' ? 'number' : 'text'}
                id="ros2Value"
                value={ros2Value}
                onChange={e => setRos2Value(e.target.value)}
                placeholder={ros2Option === 'domain' ? 'e.g., 0' : 'e.g., robot.tailnet.ts.net'}
                required
              />
            </div>
            <div className="form-group">
              <label>Ports:</label>
              <div className="port-grid">
                <label className="port-field" htmlFor="rosbridgePort">
                  <span>ROS</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9, ]*"
                    id="rosbridgePort"
                    value={servicePorts.rosbridgePort}
                    onChange={e => updateServicePort('rosbridgePort', e.target.value)}
                    onBlur={() => normalizeServicePort('rosbridgePort')}
                    placeholder={defaultServicePorts.rosbridgePort}
                    required
                  />
                </label>
                <label className="port-field" htmlFor="videoStreamPort">
                  <span>Video</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9, ]*"
                    id="videoStreamPort"
                    value={servicePorts.videoStreamPort}
                    onChange={e => updateServicePort('videoStreamPort', e.target.value)}
                    onBlur={() => normalizeServicePort('videoStreamPort')}
                    placeholder={defaultServicePorts.videoStreamPort}
                    required
                  />
                </label>
                <label className="port-field" htmlFor="meshResourcesPort">
                  <span>Mesh</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9, ]*"
                    id="meshResourcesPort"
                    value={servicePorts.meshResourcesPort}
                    onChange={e => updateServicePort('meshResourcesPort', e.target.value)}
                    onBlur={() => normalizeServicePort('meshResourcesPort')}
                    placeholder={defaultServicePorts.meshResourcesPort}
                    required
                  />
                </label>
              </div>
            </div>
            <button type="submit" className="connect-btn">
              Connect
            </button>
          </form>

          {recentConnections.length > 0 && (
            <div className="recent-connections" aria-label="Recent connections">
              <div className="recent-connections-title">Recent</div>
              <div className="recent-connections-list">
                {recentConnections.map(connection => (
                  <div key={connection.host} className="recent-connection-row">
                    <button
                      type="button"
                      className="recent-connection-btn"
                      onClick={() => handleRecentConnect(connection)}
                      title={`Connect to ${connection.host}`}
                    >
                      <span className="recent-connection-host">{connection.host}</span>
                      <span className="recent-connection-port">
                        {connection.rosbridgePort} / {connection.videoStreamPort} / {connection.meshResourcesPort}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="recent-connection-remove"
                      aria-label={`Remove ${connection.host}`}
                      onClick={event => handleRemoveRecentConnection(event, connection)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div
        ref={transitionOverlayRef}
        style={{
          position: 'fixed',
          backgroundColor: themeColors.primary,
          transform: 'translate(-50%, -50%)',
          zIndex: 1000,
          display: 'none',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

export default EntrySection;
