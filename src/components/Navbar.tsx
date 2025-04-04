import React, { useState, useRef, useEffect } from 'react';
import './Navbar.css'; // We'll create this CSS file next

type Section = 'entry' | 'simple' | '3d';

interface NavbarProps {
  currentSection: Section;
  setCurrentSection: (section: Section) => void;
}

const Navbar: React.FC<NavbarProps> = ({ currentSection, setCurrentSection }) => {
  const [bubbleStyle, setBubbleStyle] = useState({});
  const navRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const sections: { id: Section; label: string }[] = [
    { id: 'entry', label: 'Entry' },
    { id: 'simple', label: 'Simple Control' },
    { id: '3d', label: '3D View' },
  ];

  useEffect(() => {
    const currentItemIndex = sections.findIndex(sec => sec.id === currentSection);
    const currentItem = itemRefs.current[currentItemIndex];

    if (currentItem && navRef.current) {
      const navRect = navRef.current.getBoundingClientRect();
      const itemRect = currentItem.getBoundingClientRect();

      setBubbleStyle({
        left: `${itemRect.left - navRect.left}px`,
        width: `${itemRect.width}px`,
        // top: `${itemRect.top - navRect.top}px`, // Use top/height if layout is vertical
        height: `${itemRect.height}px` // Adjust based on item height
      });
    }
  }, [currentSection, sections]); // Re-run when section changes

  return (
    <nav className="navbar" ref={navRef}>
      <ul className="navbar-list">
        <div className="navbar-bubble" style={bubbleStyle}></div>
        {sections.map((section, index) => (
          <li
            key={section.id}
            ref={el => itemRefs.current[index] = el} // Assign ref to each item
            className={`navbar-item ${currentSection === section.id ? 'active' : ''}`}
            onClick={() => setCurrentSection(section.id)}
          >
            {section.label}
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default Navbar; 