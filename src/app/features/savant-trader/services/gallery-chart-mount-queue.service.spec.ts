/**
 * GalleryChartMountQueueService spec (#860) — the pacing contract: grants
 * are async, FIFO, and capped per frame so chart mounts stream across
 * frames rather than blocking one pass.
 */
import { CHART_MOUNTS_PER_FRAME, GalleryChartMountQueueService } from './gallery-chart-mount-queue.service';

describe('GalleryChartMountQueueService', () => {
  let queue: GalleryChartMountQueueService;
  let frames: FrameRequestCallback[];

  const runFrame = () => {
    const frame = frames.shift();
    expect(frame).toBeTruthy();
    frame!(0);
  };

  beforeEach(() => {
    frames = [];
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => (frames.push(cb), frames.length));
    queue = new GalleryChartMountQueueService();
  });

  afterEach(() => jest.restoreAllMocks());

  it('grants nothing synchronously — mounts are deferred to a frame', () => {
    const ran: string[] = [];
    queue.request(() => ran.push('a'));
    expect(ran).toEqual([]);
    expect(frames).toHaveLength(1);
  });

  it('grants at most CHART_MOUNTS_PER_FRAME per frame, FIFO', () => {
    const ran: string[] = [];
    queue.request(() => ran.push('a'));
    queue.request(() => ran.push('b'));
    queue.request(() => ran.push('c'));

    for (let i = 0; i < CHART_MOUNTS_PER_FRAME; i++) runFrame();
    expect(ran).toEqual(['a']);

    runFrame();
    expect(ran).toEqual(['a', 'b']);

    runFrame();
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(frames).toHaveLength(0); // queue drained — no idle frames scheduled
  });

  it('coalesces requests that arrive while a frame is pending', () => {
    const ran: string[] = [];
    queue.request(() => ran.push('a'));
    queue.request(() => ran.push('b'));
    expect(frames).toHaveLength(1); // one frame scheduled, not two
  });

  it('a request landing mid-flush queues behind already-pending grants — one frame, not two', () => {
    const ran: string[] = [];
    queue.request(() => {
      ran.push('a');
      queue.request(() => ran.push('b')); // joins during flush — behind 'c'
    });
    queue.request(() => ran.push('c'));

    runFrame(); // grants 'a' (cap 1); queue is now [c, b]
    expect(ran).toEqual(['a']);
    expect(frames).toHaveLength(1); // the mid-flush request armed ONE frame, not a second
    runFrame();
    expect(ran).toEqual(['a', 'c']);
    runFrame();
    expect(ran).toEqual(['a', 'c', 'b']);
    expect(frames).toHaveLength(0);
  });

  it('skips invalidated grants without consuming the frame budget', () => {
    // 860 review major: a card that scrolled off before its frame must not
    // eat the whole slot — dead grants are skipped free so live mounts
    // behind them aren't starved during a scroll burst.
    const ran: string[] = [];
    queue.request(() => ran.push('dead'), () => false);
    queue.request(() => ran.push('dead2'), () => false);
    queue.request(() => ran.push('live'));

    runFrame(); // both dead grants skipped; 'live' mounts this same frame
    expect(ran).toEqual(['live']);
    expect(frames).toHaveLength(0);
  });

  it('a throwing grant cannot strand the queue — the tail re-arms in finally', () => {
    const ran: string[] = [];
    queue.request(() => {
      throw new Error('boom');
    });
    queue.request(() => ran.push('b'));

    expect(() => runFrame()).toThrow('boom');
    runFrame(); // re-armed despite the throw
    expect(ran).toEqual(['b']);
    expect(frames).toHaveLength(0);
  });
});
