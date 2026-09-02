"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";

export type AbastecimientoDomainEvent = {
  sequence_id: number;
  event_id: string;
  command_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  location_id: string | null;
  audience_user_id: string | null;
  from_status: string | null;
  to_status: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
};

export type RealtimeConnectionStatus = "idle" | "connecting" | "connected" | "error";

type InvalidationReason = "event" | "sync";

type UseAbastecimientoRealtimeOptions = {
  client: SupabaseClient | null;
  topics: string[];
  enabled: boolean;
  onInvalidate: (events: AbastecimientoDomainEvent[], reason: InvalidationReason) => void | Promise<void>;
};

export function useAbastecimientoRealtime({
  client,
  topics,
  enabled,
  onInvalidate,
}: UseAbastecimientoRealtimeOptions) {
  const [status, setStatus] = useState<RealtimeConnectionStatus>("idle");
  const onInvalidateRef = useRef(onInvalidate);
  const topicKey = useMemo(() => Array.from(new Set(topics)).sort().join("\n"), [topics]);

  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    if (!client || !enabled || !topicKey) return;

    let active = true;
    let catchupId: ReturnType<typeof setTimeout> | null = null;
    let catchupQueued = false;
    let syncQueued = false;
    let operation = Promise.resolve();
    const channels = topicKey.split("\n").map((topic) =>
      client.channel(topic, { config: { private: true } }),
    );
    const subscribedTopics = new Set<string>();
    const userTopic = topicKey.split("\n").find((topic) => topic.startsWith("abastecimiento:user:"));
    const userTopicPrefix = "abastecimiento:user:";
    const cursorStorageKey = userTopic ? `kadmiel:abastecimiento:event-cursor:${userTopic.slice(userTopicPrefix.length)}` : null;
    let storedCursor = 0;
    try {
      storedCursor = Number(cursorStorageKey ? window.localStorage.getItem(cursorStorageKey) ?? 0 : 0);
    } catch {
      storedCursor = 0;
    }
    const cursorRef = { current: Number.isFinite(storedCursor) ? storedCursor : 0 };

    const rememberCursor = (sequenceId: number) => {
      if (!Number.isFinite(sequenceId) || sequenceId <= cursorRef.current) return;
      cursorRef.current = sequenceId;
      try {
        if (cursorStorageKey) window.localStorage.setItem(cursorStorageKey, String(sequenceId));
      } catch {
        // Realtime continues in memory when storage is unavailable.
      }
    };

    const runCatchup = async () => {
      for (;;) {
        const { data, error } = await client.rpc("list_abastecimiento_domain_events_after", {
          p_after_sequence: cursorRef.current,
          p_limit: 200,
        });
        if (!active) return;
        if (error) {
          setStatus("error");
          return;
        }
        const events = ((data as unknown[] | null) ?? [])
          .map(parseAbastecimientoDomainEvent)
          .filter((event): event is AbastecimientoDomainEvent => event !== null);
        if (events.length === 0) {
          setStatus("connected");
          return;
        }
        try {
          await onInvalidateRef.current(events, "event");
        } catch {
          if (active) setStatus("error");
          return;
        }
        if (!active) return;
        rememberCursor(Math.max(...events.map((event) => event.sequence_id)));
        setStatus("connected");
        if (events.length < 200) return;
      }
    };

    const enqueueCatchup = () => {
      if (!active || catchupQueued) return;
      catchupQueued = true;
      const task = async () => {
        catchupQueued = false;
        await runCatchup();
      };
      operation = operation.then(task, task);
    };

    const scheduleCatchup = () => {
      if (catchupId) clearTimeout(catchupId);
      catchupId = setTimeout(() => {
        catchupId = null;
        enqueueCatchup();
      }, 120);
    };

    const synchronize = () => {
      if (!active || syncQueued) return;
      syncQueued = true;
      const task = async () => {
        syncQueued = false;
        const { data, error } = await client.rpc("get_abastecimiento_domain_event_cursor");
        if (!active) return;
        if (error) {
          setStatus("error");
          return;
        }
        const baseline = Number(data ?? 0);
        try {
          await onInvalidateRef.current([], "sync");
        } catch {
          if (active) setStatus("error");
          return;
        }
        if (!active) return;
        rememberCursor(baseline);
        await runCatchup();
        if (active) setStatus("connected");
      };
      operation = operation.then(task, task);
    };

    const connectingId = setTimeout(() => {
      if (active) setStatus("connecting");
    }, 0);
    void client.realtime
      .setAuth()
      .then(() => {
        if (!active) return;

        channels.forEach((channel) => {
          channel
            .on("broadcast", { event: "INSERT" }, (message) => {
              const event = parseAbastecimientoDomainEvent(message);
              if (event) scheduleCatchup();
            })
            .subscribe((channelStatus) => {
              if (!active) return;
              if (channelStatus === "SUBSCRIBED") {
                subscribedTopics.add(channel.topic.replace(/^realtime:/, ""));
                if (subscribedTopics.size === channels.length) {
                  setStatus("connected");
                  synchronize();
                }
                return;
              }
              if (channelStatus === "CHANNEL_ERROR" || channelStatus === "TIMED_OUT") {
                setStatus("error");
              }
            });
        });
      })
      .catch(() => {
        if (active) setStatus("error");
      });

    const handleReconnect = () => {
      synchronize();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") handleReconnect();
    };
    const cursorIntervalId = window.setInterval(enqueueCatchup, 15_000);
    window.addEventListener("online", handleReconnect);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      clearTimeout(connectingId);
      clearInterval(cursorIntervalId);
      if (catchupId) clearTimeout(catchupId);
      window.removeEventListener("online", handleReconnect);
      document.removeEventListener("visibilitychange", handleVisibility);
      channels.forEach((channel) => {
        void client.removeChannel(channel);
      });
    };
  }, [client, enabled, topicKey]);

  return status;
}

export function parseAbastecimientoDomainEvent(message: unknown): AbastecimientoDomainEvent | null {
  if (!isRecord(message)) return null;
  const broadcastPayload = isRecord(message.payload) ? message.payload : message;
  const record = isRecord(broadcastPayload.record) ? broadcastPayload.record : broadcastPayload;

  if (
    typeof record.event_id !== "string" ||
    typeof record.event_type !== "string" ||
    typeof record.aggregate_type !== "string" ||
    typeof record.aggregate_id !== "string"
  ) {
    return null;
  }

  return {
    sequence_id: Number(record.sequence_id ?? 0),
    event_id: record.event_id,
    command_id: typeof record.command_id === "string" ? record.command_id : "",
    event_type: record.event_type,
    aggregate_type: record.aggregate_type,
    aggregate_id: record.aggregate_id,
    aggregate_version: Number(record.aggregate_version ?? 0),
    location_id: typeof record.location_id === "string" ? record.location_id : null,
    audience_user_id: typeof record.audience_user_id === "string" ? record.audience_user_id : null,
    from_status: typeof record.from_status === "string" ? record.from_status : null,
    to_status: typeof record.to_status === "string" ? record.to_status : null,
    payload: isRecord(record.payload) ? record.payload : {},
    occurred_at: typeof record.occurred_at === "string" ? record.occurred_at : "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
