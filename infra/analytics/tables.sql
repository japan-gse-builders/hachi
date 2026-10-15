-- Rendered by deploy-analytics.sh. Raw events are private to project operators.
CREATE TABLE IF NOT EXISTS `__PROJECT__.__DATASET__.call_events` (
  schema_version INT64 NOT NULL,
  event_id STRING NOT NULL,
  call_key STRING NOT NULL,
  organization_key STRING NOT NULL,
  source_revision STRING NOT NULL,
  source_updated_at TIMESTAMP NOT NULL,
  call_started_at TIMESTAMP NOT NULL,
  call_ended_at TIMESTAMP,
  status STRING NOT NULL,
  channel STRING NOT NULL,
  trigger STRING NOT NULL,
  synthetic BOOL NOT NULL,
  duration_seconds FLOAT64,
  attempt INT64 NOT NULL,
  analysis_state STRING NOT NULL,
  emergency_flagged BOOL NOT NULL,
  no_response_escalated BOOL NOT NULL,
  subscription_name STRING,
  message_id STRING,
  publish_time TIMESTAMP,
  attributes STRING
)
PARTITION BY DATE(call_started_at)
CLUSTER BY organization_key, synthetic
OPTIONS (partition_expiration_days = 90, require_partition_filter = TRUE,
  description = 'Hachi operational call snapshots; no names, contacts, transcript text or audio.');

-- Both publisher retries and Pub/Sub redelivery can duplicate rows. Source revisions, not
-- arrival time, choose the newest state even when messages arrive out of order.
CREATE OR REPLACE VIEW `__PROJECT__.__DATASET__.latest_calls` AS
SELECT * EXCEPT(subscription_name, message_id, publish_time, attributes)
FROM `__PROJECT__.__DATASET__.call_events`
WHERE call_started_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
QUALIFY ROW_NUMBER() OVER (PARTITION BY call_key ORDER BY source_revision DESC, event_id DESC) = 1;

CREATE OR REPLACE VIEW `__PROJECT__.__DATASET__.daily_operations` AS
SELECT DATE(call_started_at, 'Asia/Tokyo') AS call_date, organization_key, synthetic,
  COUNT(*) AS call_attempts,
  COUNTIF(status = 'completed') AS completed_calls,
  COUNTIF(status = 'no_answer') AS unanswered_calls,
  COUNTIF(status = 'failed') AS failed_calls,
  SAFE_DIVIDE(COUNTIF(status = 'completed'), COUNT(*)) AS completion_rate,
  AVG(IF(status = 'completed', duration_seconds, NULL)) AS average_completed_duration_seconds,
  COUNTIF(analysis_state = 'pending') AS analysis_pending,
  COUNTIF(analysis_state = 'partial') AS analysis_partial,
  COUNTIF(analysis_state = 'missing') AS analysis_missing,
  COUNTIF(emergency_flagged) AS calls_with_emergency_flags,
  COUNTIF(no_response_escalated) AS calls_with_silence_escalations
FROM `__PROJECT__.__DATASET__.latest_calls`
GROUP BY call_date, organization_key, synthetic;
