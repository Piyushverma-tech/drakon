import { useAppSelector } from '@/lib/store';
import { RefreshCcw } from 'lucide-react';
import React, { useEffect, useState, useRef, useCallback } from 'react';

export const ForecastOverlay = React.memo(function ForecastOverlay(props: {
  loading: boolean;
  onCommitOffset: (hours: number) => void;
  onReset: () => void;
}) {
  const { onCommitOffset, onReset, loading } = props;

  const { simulationOffsetHours, isSimulating, simLoading } = useAppSelector(
    (state) => state.visualization
  );

  const [draftHours, setDraftHours] = useState(simulationOffsetHours);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [utcNow, setUtcNow] = useState<Date | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDragging) setDraftHours(simulationOffsetHours);
  }, [simulationOffsetHours, isDragging]);

  useEffect(() => {
    if (isSimulating) return;
    setUtcNow(new Date());
    const t = setInterval(() => setUtcNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [isSimulating]);

  const utcLabel = utcNow
    ? utcNow.toISOString().slice(11, 19) + ' UTC'
    : '--:--:-- UTC';

  const getHoursFromEvent = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return draftHours;
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width)
      );
      return Math.round(ratio * 72);
    },
    [draftHours]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    const h = getHoursFromEvent(e.clientX);
    setDraftHours(h);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const h = getHoursFromEvent(e.clientX);
      setDraftHours(h);
    },
    [isDragging, getHoursFromEvent]
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const h = getHoursFromEvent(e.clientX);
      setDraftHours(h);
      onCommitOffset(h);
      setIsDragging(false);
    },
    [isDragging, getHoursFromEvent, onCommitOffset]
  );

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const progress = draftHours / 72;

  const formatTime = (h: number) => {
    if (!utcNow) return '--:-- UTC';
    const now = new Date(utcNow);
    now.setHours(now.getHours() + h);
    return now.toUTCString().slice(17, 22) + ' UTC';
  };

  const formatDate = (h: number) => {
    if (!utcNow) return '---';
    const now = new Date(utcNow);
    now.setHours(now.getHours() + h);
    return now.toUTCString().slice(0, 16);
  };

  const tickMarks = [0, 12, 24, 36, 48, 60, 72];

  if (loading) return null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=Syne:wght@600;700&display=swap');

        .forecast-overlay * {
          box-sizing: border-box;
        }

        .forecast-track {
          cursor: ew-resize;
          user-select: none;
        }

        .forecast-thumb {
          transition: transform 0.08s ease, box-shadow 0.08s ease;
        }

        .forecast-thumb:hover,
        .forecast-thumb.dragging {
          transform: scale(1.25);
          box-shadow: 0 0 0 4px rgba(34, 211, 238, 0.25), 0 0 16px rgba(34, 211, 238, 0.5);
        }

        .forecast-collapse-btn {
          transition: background 0.15s ease, color 0.15s ease;
        }
        .forecast-collapse-btn:hover {
          background: rgba(34, 211, 238, 0.08);
          color: rgb(165, 243, 252);
        }

        .forecast-live-btn {
          transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        }
        .forecast-live-btn:hover {
          background: rgba(34, 211, 238, 0.1);
          border-color: rgba(34, 211, 238, 0.5);
          color: rgb(165, 243, 252);
        }

        .forecast-panel-enter {
          animation: forecastSlideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes forecastSlideUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .forecast-dot-pulse {
          animation: dotPulse 2s ease-in-out infinite;
        }

        @keyframes dotPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(0.75); }
        }

        .forecast-loading-bar {
          animation: loadingBar 1.4s ease-in-out infinite;
        }

        @keyframes loadingBar {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }

        .forecast-warning-pulse {
          animation: warningPulse 3s ease-in-out infinite;
        }

        @keyframes warningPulse {
          0%, 100% { border-color: rgba(251, 191, 36, 0.2); }
          50%       { border-color: rgba(251, 191, 36, 0.45); }
        }
      `}</style>

      <div
        className="forecast-overlay"
        style={{
          position: 'absolute',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          width: 'min(720px, calc(100% - 1.5rem))',
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        <div
          style={{
            borderRadius: '16px 16px 0 0',
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(80px) saturate(180%)',
            WebkitBackdropFilter: 'blur(80px) saturate(180%)',
            border: '1px solid rgba(34, 211, 238, 0.12)',
            borderBottom: 'none',
            boxShadow:
              '0 -8px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(34, 211, 238, 0.15)',
            overflow: 'hidden',
          }}
        >
          {/* Loading bar */}
          {simLoading && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '2px',
                overflow: 'hidden',
                borderRadius: '16px 16px 0 0',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(34, 211, 238, 0.06)',
                }}
              />
              <div
                className="forecast-loading-bar"
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  width: '30%',
                  background:
                    'linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.8), transparent)',
                }}
              />
            </div>
          )}

          {/* Top accent line */}
          <div
            style={{
              height: '1px',
              background:
                'linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.5) 30%, rgba(34, 211, 238, 0.5) 70%, transparent)',
              marginBottom: 0,
            }}
          />

          {/* Header row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px 4px',
            }}
          >
            {/* Left: Label + status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                style={{
                  fontFamily: "'Syne', sans-serif",
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'rgba(34, 211, 238, 0.55)',
                }}
              >
                Forecast
              </span>

              <div
                style={{
                  width: '1px',
                  height: '12px',
                  background: 'rgba(34, 211, 238, 0.15)',
                }}
              />

              {isSimulating ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '3px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'rgba(34, 211, 238, 0.4)',
                      letterSpacing: '0.1em',
                    }}
                  >
                    T+
                  </span>
                  <span
                    style={{
                      fontSize: '18px',
                      fontWeight: 500,
                      color: 'rgb(34, 211, 238)',
                      letterSpacing: '-0.02em',
                      lineHeight: 1,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {String(draftHours).padStart(2, '0')}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'rgba(34, 211, 238, 0.5)',
                    }}
                  >
                    h
                  </span>
                </div>
              ) : (
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                  <div
                    className="forecast-dot-pulse"
                    style={{
                      width: '5px',
                      height: '5px',
                      borderRadius: '50%',
                      background: 'rgb(74, 222, 128)',
                    }}
                  />
                  <span
                    style={{
                      fontSize: '10px',
                      color: 'rgb(74, 222, 128)',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Live · {utcLabel}
                  </span>
                </div>
              )}

              {isSimulating && !simLoading && (
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'rgba(148, 163, 184, 0.5)',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {formatDate(draftHours)}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'rgba(34, 211, 238, 0.4)',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {formatTime(draftHours)}
                  </span>
                </div>
              )}

              {simLoading && (
                <span
                  style={{
                    fontSize: '11px',
                    color: 'rgba(34, 211, 238, 0.4)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  Computing…
                </span>
              )}
            </div>

            {/* Right: Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {isSimulating && (
                <button
                  onClick={onReset}
                  className="forecast-live-btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '9px',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontWeight: 500,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'rgba(34, 211, 238, 0.65)',
                    border: '1px solid rgba(34, 211, 238, 0.2)',
                    borderRadius: '6px',
                    padding: '4px 9px',
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <RefreshCcw size={10} />
                  Live
                </button>
              )}

              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="forecast-collapse-btn"
                title={isExpanded ? 'Collapse' : 'Expand'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '26px',
                  height: '26px',
                  marginBottom: '8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(34, 211, 238, 0.3)',
                  background: 'transparent',
                  color: 'rgba(34, 211, 238, 0.45)',
                  cursor: 'pointer',
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s ease',
                  }}
                >
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>
            </div>
          </div>

          {/* Expanded body */}
          {isExpanded && (
            <div
              className="forecast-panel-enter"
              style={{ padding: '12px 16px 14px' }}
            >
              {/* Custom track */}
              <div
                ref={trackRef}
                className="forecast-track"
                onMouseDown={handleMouseDown}
                style={{
                  position: 'relative',
                  height: '28px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {/* Track background */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    height: '3px',
                    borderRadius: '2px',
                    background: 'rgba(34, 211, 238, 0.08)',
                    border: '1px solid rgba(34, 211, 238, 0.08)',
                  }}
                />

                {/* Filled portion */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    height: '3px',
                    width: `${progress * 100}%`,
                    borderRadius: '2px',
                    background:
                      'linear-gradient(90deg, rgba(34, 211, 238, 0.4), rgba(34, 211, 238, 0.85))',
                    boxShadow: '0 0 8px rgba(34, 211, 238, 0.3)',
                    transition: isDragging ? 'none' : 'width 0.08s ease',
                  }}
                />

                {/* Tick marks */}
                {tickMarks.map((tick) => (
                  <div
                    key={tick}
                    style={{
                      position: 'absolute',
                      left: `${(tick / 72) * 100}%`,
                      transform: 'translateX(-50%)',
                      width: tick === 0 || tick === 72 ? '2px' : '1px',
                      height: tick === 0 || tick === 72 ? '8px' : '5px',
                      borderRadius: '1px',
                      background:
                        tick <= draftHours
                          ? 'rgba(34, 211, 238, 0.5)'
                          : 'rgba(34, 211, 238, 0.15)',
                      top: '50%',
                      marginTop: '-3px',
                      transition: 'background 0.1s ease',
                    }}
                  />
                ))}

                {/* Thumb */}
                <div
                  className={`forecast-thumb ${isDragging ? 'dragging' : ''}`}
                  style={{
                    position: 'absolute',
                    left: `${progress * 100}%`,
                    transform: 'translateX(-50%)',
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    background: 'rgb(34, 211, 238)',
                    boxShadow:
                      '0 0 0 2px rgba(34, 211, 238, 0.25), 0 0 10px rgba(34, 211, 238, 0.4)',
                    cursor: 'ew-resize',
                    transition: isDragging ? 'none' : 'left 0.08s ease',
                    zIndex: 2,
                  }}
                />
              </div>

              {/* Tick labels */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '4px',
                  paddingLeft: '0',
                  paddingRight: '0',
                }}
              >
                {tickMarks.map((tick) => (
                  <span
                    key={tick}
                    onClick={() => {
                      setDraftHours(tick);
                      onCommitOffset(tick);
                    }}
                    style={{
                      fontSize: '9px',
                      fontFamily: "'IBM Plex Mono', monospace",
                      color:
                        Math.abs(draftHours - tick) < 6
                          ? 'rgba(34, 211, 238, 0.75)'
                          : 'rgba(148, 163, 184, 0.55)',
                      letterSpacing: '0.04em',
                      cursor: 'pointer',
                      transition: 'color 0.15s ease',
                      transform: 'translateX(-50%)',
                      userSelect: 'none',
                    }}
                  >
                    {tick === 0 ? 'NOW' : `+${tick}h`}
                  </span>
                ))}
              </div>

              {/* Warning */}
              {isSimulating && draftHours > 48 && (
                <div
                  className="forecast-warning-pulse"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '7px',
                    marginTop: '10px',
                    fontSize: '9px',
                    color: 'rgba(251, 191, 36, 0.8)',
                    background: 'rgba(251, 191, 36, 0.04)',
                    border: '1px solid rgba(251, 191, 36, 0.2)',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    lineHeight: 1.5,
                    letterSpacing: '0.03em',
                  }}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      flexShrink: 0,
                      marginTop: '2px',
                      color: 'rgba(251, 191, 36, 0.7)',
                    }}
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>
                    SGP4 accuracy degrades beyond 48h — propagation beyond this
                    window is indicative only.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
});
