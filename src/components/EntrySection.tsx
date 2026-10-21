import React, { useState, useEffect, useRef, useId } from 'react';
import { FiChevronDown, FiSliders } from 'react-icons/fi';
import type { ConnectionParams } from '../runtime/connections';
import './EntrySection.css';
import { brand } from '../features/enterprise/config';
import { getEnterpriseSession, hasEnterpriseRobots } from '../features/enterprise/session';
import BrandMark from '../features/enterprise/BrandMark';
import RoboBoyAttribution from './RoboBoyAttribution';
import anime from 'animejs';
import { animateLandingPage, animateAdvancedForm, animateButtonPress, prefersReducedMotion } from '../utils/animations';
import {
  getDefaultConnectionHost,
  getDefaultServicePorts,
  normalizeRuntimeServicePorts,
  type RuntimeServicePorts,
} from '../runtime/runtimeConfig';
import { loadRecentConnections, RecentConnection, removeRecentConnection } from '../runtime/recentConnections';

interface EntrySectionProps {
  onConnect: (params: ConnectionParams) => void;
  embedded?: boolean;
}

type PortKey = keyof RuntimeServicePorts;

const ConnectionPlusIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
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

const EntrySection: React.FC<EntrySectionProps> = ({ onConnect, embedded = false }) => {
  const fleet = hasEnterpriseRobots() ? (getEnterpriseSession()?.robots ?? []) : [];
  const [robotId, setRobotId] = useState(fleet[0]?.id ?? '');
  const [ros2Value, setRos2Value] = useState<string>('');
  const [servicePorts, setServicePorts] = useState<RuntimeServicePorts>(() => getDefaultServicePorts());
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [recentConnections, setRecentConnections] = useState<RecentConnection[]>(() => loadRecentConnections());

  // Where Quick Connect goes: the host the page was served from in a browser, and in the packaged
  // app the last one that worked, including its saved ports. A packaged app on its first launch
  // has neither, so there is nothing to connect quickly to and the form that asks for a host is the screen itself.
  const defaultHostname = getDefaultConnectionHost();
  const quickConnectHistory = defaultHostname ? undefined : recentConnections[0];
  const currentHostname = defaultHostname || quickConnectHistory?.host || '';
  const needsConnectionTarget = !currentHostname;

  const [showAdvanced, setShowAdvanced] = useState(needsConnectionTarget);
  const formId = useId();
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
    if (!dashRef.current || prefersReducedMotion()) return;

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
      ros2Option: 'ip',
      ros2Value,
      ...selectedPorts,
    };
    onConnect(params);
  };

  const handleQuickConnect = () => {
    if (isTransitioning) return;

    setIsTransitioning(true);
    const complete = () => {
      const selectedPorts = normalizeRuntimeServicePorts(quickConnectHistory ?? servicePorts, defaultServicePorts);
      onConnect({
        ros2Option: 'ip',
        ros2Value: currentHostname,
        ...selectedPorts,
        ...(robotId ? { enterpriseRobotId: robotId } : {}),
      });
    };
    if (prefersReducedMotion()) {
      complete();
      return;
    }
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
      complete,
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
    <div className={`entry-section-container ${embedded ? 'is-embedded' : ''}`} ref={containerRef}>
      <div className="entry-section card" data-testid="entry-section">
        <div className="logo-container" ref={logoRef}>
          {brand.name !== 'Robo-Boy' || brand.logo ? (
            <h1 className="app-title">
              <BrandMark />
            </h1>
          ) : (
            <h1 className="app-title">
              <span className="title-robo">Robo</span>
              <span className="title-dash" ref={dashRef}>
                -
              </span>
              <span className="title-boy">Boy</span>
            </h1>
          )}
        </div>

        <h2 className="connection-heading">Connect your robots</h2>
        <p className="connection-intro">Each connection has its own workspace. Add more as you go.</p>
        <div className="connection-options">
          {fleet.length > 0 && (
            <label className="enterprise-robot-picker">
              Robot
              <select aria-label="Robot" value={robotId} onChange={event => setRobotId(event.target.value)}>
                {fleet.map(robot => (
                  <option key={robot.id} value={robot.id}>
                    {robot.name}
                  </option>
                ))}
              </select>
              <span>Choose a robot. Each connection has its own workspace and control.</span>
            </label>
          )}
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
              {!hasEnterpriseRobots() && (
                <button
                  type="button"
                  className="advanced-toggle connection-disclosure"
                  onClick={toggleAdvanced}
                  title="Advanced Options"
                  aria-expanded={showAdvanced}
                  aria-controls={formId}
                >
                  <span className={`connection-disclosure-icon ${showAdvanced ? 'is-open' : ''}`}>
                    <ConnectionPlusIcon />
                  </span>
                  <span className="connection-disclosure-copy">
                    <strong>{showAdvanced ? 'Hide connection details' : 'Choose another robot'}</strong>
                    <span>Enter a host or IP address</span>
                  </span>
                </button>
              )}
            </>
          )}

          <form
            id={formId}
            aria-hidden={!showAdvanced}
            onSubmit={handleSubmit}
            ref={formRef}
            className={`advanced-form ${showAdvanced ? 'visible' : ''}`}
          >
            <div className="form-group">
              <label htmlFor="ros2Value">Host or IP:</label>
              <input
                type="text"
                id="ros2Value"
                value={ros2Value}
                onChange={e => setRos2Value(e.target.value)}
                placeholder="e.g., 192.168.1.42 or robot.local"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </div>
            <details className="connection-ports">
              <summary>
                <FiSliders className="connection-ports-icon" aria-hidden="true" />
                <span>Connection ports</span>
                <FiChevronDown className="connection-ports-chevron" aria-hidden="true" />
              </summary>
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
            </details>
            <button type="submit" className="connect-btn">
              Connect
            </button>
          </form>
          <button
            type="button"
            className="advanced-toggle"
            onClick={() => onConnect({ offline: true, ros2Option: 'ip', ros2Value: 'localhost' })}
          >
            Open local recordings
          </button>

          {!hasEnterpriseRobots() && recentConnections.length > 0 && (
            <div className="recent-connections" aria-label="Recent connections">
              <div className="recent-connections-title">
                <span>Recent</span>
                <span>{recentConnections.length} saved</span>
              </div>
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
        <div className="entry-attribution">
          <RoboBoyAttribution />
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
