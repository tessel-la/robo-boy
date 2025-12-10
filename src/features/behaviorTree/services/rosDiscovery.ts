import type { Ros } from 'roslib';
import * as ROSLIB from 'roslib';
import {
  ROSDiscoveryResult,
  ROSActionInfo,
  ROSServiceInfo,
  ROSTopicInfo,
} from '../types';

/**
 * Discover available ROS actions by inspecting both services and topics.
 * ROS 2 action servers expose services (send_goal/get_result/cancel_goal)
 * and topics (feedback/status) with the "_action" infix.
 */
export const discoverROSActions = async (ros: Ros): Promise<ROSActionInfo[]> => {
  return new Promise((resolve) => {
    const rosApi = ros as any;
    const actionBases = new Set<string>();
    const actionSuffixes = [
      '/_action/send_goal',
      '/_action/get_result',
      '/_action/cancel_goal',
      '/_action/feedback',
      '/_action/status',
      '/_action/goal', // ROS1-style bridge safety net
      '/_action/result',
    ];

    const registerBase = (path: string) => {
      const idx = path.indexOf('/_action');
      if (idx > 0) {
        actionBases.add(path.substring(0, idx));
        return;
      }
      // Fallback: accept bare action names (no _action infix) when provided directly
      actionBases.add(path);
    };

    const discoverViaRosApi = () =>
      new Promise<void>((done) => {
        try {
          const srv = new (ROSLIB as any).Service({
            ros,
            name: '/rosapi/action_servers',
            serviceType: 'rosapi_msgs/srv/ActionServers',
          });
          srv.callService(
            {},
            (res: any) => {
              const servers: string[] = res?.action_servers || [];
              servers.forEach((name: string) => registerBase(name));
              done();
            },
            (err: any) => {
              console.error('[BT] rosapi action_servers failed:', err);
              done();
            }
          );
        } catch (e) {
          console.error('[BT] rosapi action_servers call error:', e);
          done();
        }
      });

    let pending = 3;
    const finish = () => {
      pending -= 1;
      if (pending > 0) return;

      const actions: ROSActionInfo[] = Array.from(actionBases.values())
        .filter((n) => n && n.startsWith('/'))
        .map((name) => {
          const parts = name.split('/').filter(Boolean);
          const namespace = parts.slice(0, -1).join('/');
          return {
            name,
            type: 'action',
            namespace: namespace || '/',
          };
        });

      console.log('[BT] Total actions discovered:', actions.length);
      resolve(actions);
    };

    rosApi.getServices(
      (services: string[]) => {
        console.log('[BT] Discovering actions from services:', services.length);
        services.forEach((service) => {
          if (actionSuffixes.some((suffix) => service.includes(suffix))) {
            registerBase(service);
            console.log('[BT] Found action service:', service);
          }
        });
        finish();
      },
      (error: any) => {
        console.error('[BT] Failed to discover ROS actions via services:', error);
        finish();
      }
    );

    rosApi.getTopics(
      (result: any) => {
        const topics: string[] = result?.topics || [];
        console.log('[BT] Discovering actions from topics:', topics.length);
        topics.forEach((topic: string) => {
          if (actionSuffixes.some((suffix) => topic.includes(suffix))) {
            registerBase(topic);
            console.log('[BT] Found action topic:', topic);
          }
        });
        finish();
      },
      (error: any) => {
        console.error('[BT] Failed to discover ROS actions via topics:', error);
        finish();
      }
    );

    discoverViaRosApi().then(finish);
  });
};

/**
 * Discover available ROS services
 */
export const discoverROSServices = async (ros: Ros): Promise<ROSServiceInfo[]> => {
  return new Promise((resolve) => {
    const rosApi = ros as any;
    rosApi.getServices(
      (services: string[]) => {
        // Filter out system services that users typically don't need
        const filteredServices = services.filter(
          (service) =>
            !service.startsWith('/rosout') &&
            !service.startsWith('/_') &&
            !service.includes('/get_loggers') &&
            !service.includes('/set_logger_level') &&
            !service.includes('/describe_parameters') &&
            !service.includes('/get_parameter') &&
            !service.includes('/list_parameters')
        );

        const serviceInfos: ROSServiceInfo[] = filteredServices.map((service) => ({
          name: service,
          type: 'unknown', // Service type needs separate query
        }));

        resolve(serviceInfos);
      },
      (error: any) => {
        console.error('Failed to discover ROS services:', error);
        resolve([]);
      }
    );
  });
};

/**
 * Discover available ROS topics suitable for publishing
 */
export const discoverROSTopics = async (ros: Ros): Promise<ROSTopicInfo[]> => {
  return new Promise((resolve) => {
    const rosApi = ros as any;
    rosApi.getTopics(
      (result: any) => {
        // Filter out system topics and action-related topics
        const filteredTopics = result.topics
          .map((topic: string, index: number) => ({
            name: topic,
            type: result.types[index],
          }))
          .filter(
            (topic: { name: string; type: string }) =>
              !topic.name.startsWith('/rosout') &&
              !topic.name.includes('/_action/') &&
              !topic.name.startsWith('/_') &&
              !topic.name.includes('/parameter_events') &&
              topic.type !== '' // Filter out topics without type info
          );

        const topicInfos: ROSTopicInfo[] = filteredTopics.map((topic: { name: string; type: string }) => ({
          name: topic.name,
          type: topic.type,
        }));

        resolve(topicInfos);
      },
      (error: any) => {
        console.error('Failed to discover ROS topics:', error);
        resolve([]);
      }
    );
  });
};

/**
 * Discover all available ROS resources (actions, services, topics)
 */
export const discoverAllROSResources = async (
  ros: Ros
): Promise<ROSDiscoveryResult> => {
  try {
    const [actions, services, topics] = await Promise.all([
      discoverROSActions(ros),
      discoverROSServices(ros),
      discoverROSTopics(ros),
    ]);

    return {
      actions,
      services,
      topics,
    };
  } catch (error) {
    console.error('Failed to discover ROS resources:', error);
    return {
      actions: [],
      services: [],
      topics: [],
    };
  }
};

/**
 * Get service type for a specific service
 */
export const getServiceType = async (
  ros: Ros,
  serviceName: string
): Promise<string | null> => {
  return new Promise((resolve) => {
    const rosApi = ros as any;
    rosApi.getServiceType(
      serviceName,
      (type: string) => {
        resolve(type);
      },
      (error: any) => {
        console.error(`Failed to get service type for ${serviceName}:`, error);
        resolve(null);
      }
    );
  });
};

/**
 * Get message type for a specific topic
 */
export const getTopicType = async (
  ros: Ros,
  topicName: string
): Promise<string | null> => {
  return new Promise((resolve) => {
    const rosApi = ros as any;
    rosApi.getTopicType(
      topicName,
      (type: string) => {
        resolve(type);
      },
      (error: any) => {
        console.error(`Failed to get topic type for ${topicName}:`, error);
        resolve(null);
      }
    );
  });
};

