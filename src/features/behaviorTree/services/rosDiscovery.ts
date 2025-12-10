import type { Ros } from 'roslib';
import {
  ROSDiscoveryResult,
  ROSActionInfo,
  ROSServiceInfo,
  ROSTopicInfo,
} from '../types';

/**
 * Discover available ROS actions by looking for action server topics.
 * Action servers typically have topics with suffixes: /goal, /result, /feedback, /status, /cancel
 */
export const discoverROSActions = async (ros: Ros): Promise<ROSActionInfo[]> => {
  return new Promise((resolve) => {
    ros.getTopics(
      (result) => {
        const actionMap = new Map<string, Set<string>>();

        // Look for action-related topics
        result.topics.forEach((topic: string, index: number) => {
          const type = result.types[index];
          
          // Check for action server topic patterns
          const actionSuffixes = ['/_action/status', '/_action/feedback', '/_action/result'];
          const goalSuffix = '/_action/send_goal';
          
          for (const suffix of actionSuffixes) {
            if (topic.endsWith(suffix)) {
              const baseName = topic.substring(0, topic.indexOf('/_action'));
              if (!actionMap.has(baseName)) {
                actionMap.set(baseName, new Set());
              }
              actionMap.get(baseName)!.add(suffix);
            }
          }
          
          // Also check for goal topics to identify action type
          if (topic.endsWith(goalSuffix)) {
            const baseName = topic.substring(0, topic.indexOf('/_action'));
            if (!actionMap.has(baseName)) {
              actionMap.set(baseName, new Set());
            }
            actionMap.get(baseName)!.add('goal');
          }
        });

        // Convert to action info array
        const actions: ROSActionInfo[] = Array.from(actionMap.entries())
          .filter(([_, suffixes]) => suffixes.size >= 2) // At least 2 related topics
          .map(([name, _]) => {
            // Extract namespace and action name
            const parts = name.split('/').filter(p => p);
            const actionName = parts[parts.length - 1];
            const namespace = parts.slice(0, -1).join('/');
            
            return {
              name,
              type: 'action', // Type will be determined at execution time
              namespace: namespace || '/',
            };
          });

        resolve(actions);
      },
      (error) => {
        console.error('Failed to discover ROS actions:', error);
        resolve([]);
      }
    );
  });
};

/**
 * Discover available ROS services
 */
export const discoverROSServices = async (ros: Ros): Promise<ROSServiceInfo[]> => {
  return new Promise((resolve) => {
    ros.getServices(
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
      (error) => {
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
    ros.getTopics(
      (result) => {
        // Filter out system topics and action-related topics
        const filteredTopics = result.topics
          .map((topic: string, index: number) => ({
            name: topic,
            type: result.types[index],
          }))
          .filter(
            (topic) =>
              !topic.name.startsWith('/rosout') &&
              !topic.name.includes('/_action/') &&
              !topic.name.startsWith('/_') &&
              !topic.name.includes('/parameter_events') &&
              topic.type !== '' // Filter out topics without type info
          );

        const topicInfos: ROSTopicInfo[] = filteredTopics.map((topic) => ({
          name: topic.name,
          type: topic.type,
        }));

        resolve(topicInfos);
      },
      (error) => {
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
    ros.getServiceType(
      serviceName,
      (type: string) => {
        resolve(type);
      },
      (error) => {
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
    ros.getTopicType(
      topicName,
      (type: string) => {
        resolve(type);
      },
      (error) => {
        console.error(`Failed to get topic type for ${topicName}:`, error);
        resolve(null);
      }
    );
  });
};

