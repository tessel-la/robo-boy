import React, { useState, useEffect, useRef } from 'react';
import { ConnectionParams } from '../App'; // Adjust if ConnectionParams definition changes
import './EntrySection.css';
import anime from 'animejs';
import { animateLandingPage, animateAdvancedForm, animateButtonPress } from '../utils/animations';

interface EntrySectionProps {
  onConnect: (params: ConnectionParams) => void;
}

// Simple gear icon component for the advanced options
const GearIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
);

// Dropdown caret icon component
const CaretIcon = ({ isOpen }: { isOpen: boolean }) => (
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const logoRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const quickConnectRef = useRef<HTMLButtonElement>(null);
  const dashRef = useRef<HTMLSpanElement>(null);
  // Track theme changes
  const [themeColors, setThemeColors] = useState({
    primary: '',
    hover: ''
  });

  // Get current hostname for quick connect
  const currentHostname = window.location.hostname;

  // Watch for theme changes
  useEffect(() => {
    const checkTheme = () => {
      const style = getComputedStyle(document.documentElement);
      const primary = style.getPropertyValue('--primary-color').trim();
      const hover = style.getPropertyValue('--primary-hover-color').trim();
      
      if (primary !== themeColors.primary || hover !== themeColors.hover) {
        setThemeColors({
          primary,
          hover
        });
      }
    };

    // Initial check
    checkTheme();

    // Set up observer to watch for theme changes (attribute changes)
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { 
      attributes: true,
      attributeFilter: ['data-theme'] 
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
    const gearIcon = document.querySelector('.advanced-toggle-content svg');
    if (gearIcon) {
      anime({
        targets: gearIcon,
        rotate: showAdvanced ? 180 : 0,
        duration: 500,
        easing: 'easeInOutQuad'
      });
    }
  }, [showAdvanced]);

  // Helper function to convert hex to rgb
  const hexToRgb = (hex: string): string => {
    // Default fallback in case of parsing issues
    if (!hex || !hex.startsWith('#')) return '50, 205, 50';

    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    const fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
    
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
    const primaryColor = style.getPropertyValue('--primary-color').trim();
    const hoverColor = style.getPropertyValue('--primary-hover-color').trim();

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
          { value: 0, duration: 500, easing: 'easeInOutBack' }
        ] as any,
        duration: 2200
      })
      .add({
        targets: dashRef.current,
        translateY: [
          { value: -4, duration: 300, easing: 'easeOutExpo' },
          { value: 0, duration: 600, easing: 'easeInElastic' }
        ] as any,
        scale: [
          { value: 1.2, duration: 300, easing: 'easeOutExpo' },
          { value: 1, duration: 600, easing: 'easeInElastic' }
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

    const params: ConnectionParams = {
      ros2Option,
      ros2Value: ros2Option === 'domain' ? parseInt(ros2Value, 10) || 0 : ros2Value,
    };
    onConnect(params);
  };

  const handleQuickConnect = () => {
    // Animate the quick connect button on press
    animateButtonPress(quickConnectRef.current);
    
    const params: ConnectionParams = {
      ros2Option: 'ip',
      ros2Value: currentHostname,
    };
    onConnect(params);
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
            <span className="title-dash" ref={dashRef}>-</span>
            <span className="title-boy">Boy</span>
          </h1>
        </div>

        <div className="connection-options">
          <button 
            className="quick-connect-btn" 
            onClick={handleQuickConnect}
            title={`Connect to ${currentHostname}`}
            ref={quickConnectRef}
            style={{ position: 'relative' }}
          >
            Quick Connect
            <span className="quick-connect-ip">{currentHostname}</span>
          </button>

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
              alignItems: 'center'
            }}
          >
            <span className="advanced-toggle-content">
              <GearIcon />
            </span>
          </button>
          
          <form 
            onSubmit={handleSubmit} 
            ref={formRef} 
            className={`advanced-form ${showAdvanced ? 'visible' : ''}`}
          >
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
            <button type="submit" className="connect-btn">Connect</button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EntrySection; 