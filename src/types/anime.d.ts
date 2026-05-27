declare module 'animejs' {
  namespace anime {
    interface AnimeParams {
      targets: string | HTMLElement | HTMLElement[] | NodeList | null;
      duration?: number;
      delay?: number;
      endDelay?: number;
      easing?: string;
      round?: number;
      complete?: Function;
      update?: Function;
      begin?: Function;
      loop?: boolean | number;
      direction?: 'normal' | 'reverse' | 'alternate';
      autoplay?: boolean;
      translateX?: number | number[] | string | string[] | any;
      translateY?: number | number[] | string | string[] | any;
      rotate?: number | number[] | string | string[] | any;
      scale?: number | number[] | string | string[] | any;
      opacity?: number | number[] | string | string[] | any;
      color?: string | string[] | any;
      offset?: string | number;
      [prop: string]: any;
    }

    interface AnimeInstance {
      play: () => void;
      pause: () => void;
      restart: () => void;
      reverse: () => void;
      seek: (time: number) => void;
      completed: boolean;
      began: boolean;
      paused: boolean;
      finished: Promise<void>;
    }

    interface AnimeTimelineInstance extends AnimeInstance {
      add: (params: AnimeParams, timeOffset?: string | number) => AnimeTimelineInstance;
    }

    interface AnimeStatic {
      (params: AnimeParams): AnimeInstance;
      timeline: (params?: Omit<AnimeParams, 'targets'>) => AnimeTimelineInstance;
    }
  }

  const anime: anime.AnimeStatic;
  export = anime;
} 