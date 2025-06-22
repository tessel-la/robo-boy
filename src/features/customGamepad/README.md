# Custom Gamepad System

The Custom Gamepad System allows users to create, edit, and use personalized control layouts within the Robo-Boy application. This modular system provides a drag-and-drop interface for designing custom gamepads with various components.

## Features

### 🎮 Component Library
- **Joystick**: Analog stick for continuous 2D control
- **Button**: Momentary or toggle buttons for discrete actions
- **D-Pad**: 4-directional pad for movement control
- **Toggle**: On/off switches for binary states
- **Slider**: Linear control for single-axis values

### 🛠️ Editor Features
- **Grid-based Design**: Configurable grid system for precise component placement
- **Drag & Drop**: Intuitive component placement
- **Real-time Preview**: See your gamepad in action while designing
- **Property Editor**: Configure component behavior, topics, and styling
- **Responsive Grid**: Adjustable grid size and cell dimensions

### 💾 Storage & Management
- **Local Storage**: Gamepads saved locally in browser
- **Import/Export**: Share gamepad layouts via JSON files
- **Default Layouts**: Pre-built layouts for common use cases
- **Version Control**: Layout versioning and metadata tracking

## Usage

### Creating a Custom Gamepad

1. **Open the Editor**
   - Click the "+" button in the control panel tabs
   - Select "Create Custom Gamepad" from the menu

2. **Design Your Layout**
   - **Design Tab**: Drag components from the palette to the grid
   - **Settings Tab**: Configure name, description, and grid properties
   - **Preview Tab**: Test your gamepad layout

3. **Configure Components**
   - Click on any component to select it
   - Use the Properties panel to configure:
     - Label text
     - ROS topic assignments
     - Component-specific settings
     - Visual styling

4. **Save Your Gamepad**
   - Click "Save Gamepad" to store your layout
   - The gamepad will appear in your custom layouts list

### Using Custom Gamepads

1. **Add to Control Panel**
   - Click the "+" button in control panel tabs
   - Select your custom gamepad from "Custom Layouts"

2. **Multiple Instances**
   - Create multiple instances of the same layout
   - Each instance can have different topic configurations

### Managing Layouts

- **Edit Existing**: Select a custom gamepad and modify it
- **Delete**: Remove unwanted custom layouts
- **Export**: Share layouts with other users
- **Import**: Load layouts from JSON files

## Architecture

### Core Components

```
src/features/customGamepad/
├── types.ts                 # TypeScript interfaces and types
├── defaultLayouts.ts        # Pre-built layouts and component library
├── gamepadStorage.ts        # Local storage management
└── components/
    ├── GamepadEditor.tsx    # Main editor interface
    ├── CustomGamepadLayout.tsx # Layout renderer
    ├── GamepadComponent.tsx # Component wrapper
    ├── JoystickComponent.tsx
    ├── ButtonComponent.tsx
    ├── DPadComponent.tsx
    ├── ToggleComponent.tsx
    └── SliderComponent.tsx
```

### Data Flow

1. **Layout Definition**: JSON-based layout configuration
2. **Component Rendering**: Dynamic component instantiation
3. **ROS Integration**: Automatic topic publishing/subscribing
4. **State Management**: Real-time component state tracking

### Storage Format

```json
{
  "id": "custom-gamepad-1",
  "name": "My Custom Gamepad",
  "description": "Custom layout for my robot",
  "gridSize": { "width": 12, "height": 8 },
  "cellSize": 60,
  "components": [
    {
      "id": "joystick-1",
      "type": "joystick",
      "position": { "x": 1, "y": 2, "width": 3, "height": 3 },
      "label": "Movement",
      "action": {
        "topic": "/cmd_vel",
        "messageType": "geometry_msgs/Twist"
      },
      "config": {
        "maxValue": 1.0,
        "axes": ["linear.x", "angular.z"]
      }
    }
  ],
  "rosConfig": {
    "defaultTopic": "/joy",
    "defaultMessageType": "sensor_msgs/Joy"
  },
  "metadata": {
    "created": "2024-01-01T00:00:00.000Z",
    "modified": "2024-01-01T00:00:00.000Z",
    "version": "1.0.0"
  }
}
```

## Component Configuration

### Joystick
```typescript
{
  type: 'joystick',
  config: {
    maxValue: 1.0,           // Maximum output value
    axes: ['linear.x', 'angular.z']  // ROS message fields
  }
}
```

### Button
```typescript
{
  type: 'button',
  config: {
    buttonIndex: 0,          // Joy message button index
    momentary: true          // true = momentary, false = toggle
  }
}
```

### D-Pad
```typescript
{
  type: 'dpad',
  config: {
    buttonMapping: {         // Direction to button index mapping
      up: 0,
      right: 1,
      down: 2,
      left: 3
    }
  }
}
```

### Toggle
```typescript
{
  type: 'toggle',
  config: {
    // Toggle-specific configuration
  }
}
```

### Slider
```typescript
{
  type: 'slider',
  config: {
    min: -1.0,              // Minimum value
    max: 1.0,               // Maximum value
    step: 0.1,              // Step size
    orientation: 'horizontal' // 'horizontal' or 'vertical'
  }
}
```

## ROS Integration

### Supported Message Types
- `sensor_msgs/Joy`: Standard joystick messages
- `geometry_msgs/Twist`: Velocity commands
- `std_msgs/Bool`: Boolean values
- `std_msgs/Float64`: Numeric values
- Custom message types (configurable)

### Topic Configuration
Each component can be configured to publish to specific ROS topics:
- **Topic Name**: The ROS topic to publish to
- **Message Type**: The ROS message type
- **Field Mapping**: Which message fields to populate

### Action/Service Support
Components can also trigger ROS actions and services:
- **Action Calls**: For complex robot behaviors
- **Service Calls**: For one-time operations
- **Parameter Setting**: For configuration changes

## Extending the System

### Adding New Component Types

1. **Create Component File**
   ```typescript
   // src/features/customGamepad/components/MyComponent.tsx
   import React from 'react';
   import { GamepadComponentProps } from './GamepadComponent';
   
   const MyComponent: React.FC<GamepadComponentProps> = ({ config, ros, onUpdate }) => {
     // Component implementation
   };
   ```

2. **Update Types**
   ```typescript
   // src/features/customGamepad/types.ts
   export interface GamepadComponentConfig {
     type: 'joystick' | 'button' | 'dpad' | 'toggle' | 'slider' | 'mycomponent';
     // ... other properties
   }
   ```

3. **Add to Component Library**
   ```typescript
   // src/features/customGamepad/defaultLayouts.ts
   export const componentLibrary = [
     // ... existing components
     {
       type: 'mycomponent' as const,
       name: 'My Component',
       description: 'Custom component description',
       defaultSize: { width: 2, height: 2 },
       icon: '🔧'
     }
   ];
   ```

4. **Register in Renderer**
   ```typescript
   // src/features/customGamepad/components/GamepadComponent.tsx
   switch (config.type) {
     // ... existing cases
     case 'mycomponent':
       return <MyComponent {...props} />;
   }
   ```

### Custom Message Types

Add support for new ROS message types by extending the action configuration:

```typescript
{
  action: {
    topic: '/my_topic',
    messageType: 'my_package/MyMessage',
    field: 'my_field'
  }
}
```

## Best Practices

### Layout Design
- **Grid Planning**: Plan your layout on paper first
- **Component Spacing**: Leave space between interactive elements
- **Logical Grouping**: Group related controls together
- **Size Appropriately**: Match component size to importance

### Performance
- **Minimize Components**: Use only necessary components
- **Efficient Topics**: Avoid high-frequency topic publishing
- **State Management**: Keep component state minimal

### Usability
- **Clear Labels**: Use descriptive component labels
- **Consistent Styling**: Maintain visual consistency
- **Test Thoroughly**: Test all component interactions
- **Document Layouts**: Add descriptions to complex layouts

## Troubleshooting

### Common Issues

1. **Component Not Responding**
   - Check ROS topic configuration
   - Verify message type compatibility
   - Ensure ROS connection is active

2. **Layout Not Saving**
   - Check browser local storage limits
   - Verify layout name is unique
   - Clear browser cache if needed

3. **Grid Alignment Issues**
   - Adjust grid size and cell size
   - Check component position values
   - Use snap-to-grid feature

4. **Performance Issues**
   - Reduce component count
   - Optimize topic publishing rates
   - Check for memory leaks

### Debug Mode

Enable debug logging by setting:
```javascript
localStorage.setItem('robo-boy-debug', 'true');
```

This will log component interactions and ROS message publishing to the browser console.

## Future Enhancements

- **Cloud Storage**: Save layouts to cloud storage
- **Collaborative Editing**: Share and edit layouts with teams
- **Template System**: Create layout templates
- **Advanced Styling**: More customization options
- **Gesture Support**: Touch and gesture controls
- **Voice Integration**: Voice command components
- **Analytics**: Usage analytics and optimization suggestions 