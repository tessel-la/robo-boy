import { Ros } from 'roslib';
import { Scene, Mesh, Texture } from 'three';
import { UrdfClient } from '../../src/utils/ros3d';

// Uses the real ROS subscription and Three loaders, with no controls or command publishers.
(window as any).loadTestRobot = async (base: string, description?: string, rosbridge?: string) => {
  const ros = new Ros(rosbridge ? { url: rosbridge } : {});
  const scene = new Scene();
  const errors: string[] = [];
  const client = new UrdfClient({
    ros,
    path: base,
    rootObject: scene,
    tfClient: { subscribe() {}, unsubscribe() {} } as any,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Robot assets timed out: ${errors.join(', ')}`)), 30000);
      (client as any).resourceManager.onError = (url: string) => errors.push(url);
      (client as any).resourceManager.onLoad = () => {
        clearTimeout(timer);
        resolve();
      };
      if (description) ros.emit('/robot_description', { data: description });
    });
    let meshes = 0;
    let textures = 0;
    scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      meshes++;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) {
          if (value instanceof Texture && value.image?.width > 0) textures++;
        }
      }
    });
    return { meshes, textures, errors };
  } finally {
    client.dispose();
    if (rosbridge) ros.close();
  }
};
