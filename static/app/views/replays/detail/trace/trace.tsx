import {useMemo} from 'react';
import styled from '@emotion/styled';

import Loading from 'sentry/components/loadingIndicator';
import Placeholder from 'sentry/components/placeholder';
import {IconSad} from 'sentry/icons';
import {t} from 'sentry/locale';
import type {Organization} from 'sentry/types/organization';
import type EventView from 'sentry/utils/discover/eventView';
import type {TraceError} from 'sentry/utils/performance/quickTrace/types';
import useRouteAnalyticsParams from 'sentry/utils/routeAnalytics/useRouteAnalyticsParams';
import {useLocation} from 'sentry/utils/useLocation';
import useOrganization from 'sentry/utils/useOrganization';
import useProjects from 'sentry/utils/useProjects';
import {useReplayTraceMeta} from 'sentry/views/performance/newTraceDetails/traceApi/useReplayTraceMeta';
import {useTrace} from 'sentry/views/performance/newTraceDetails/traceApi/useTrace';
import {useTraceRootEvent} from 'sentry/views/performance/newTraceDetails/traceApi/useTraceRootEvent';
import {useTraceTree} from 'sentry/views/performance/newTraceDetails/traceApi/useTraceTree';
import type {TraceTree} from 'sentry/views/performance/newTraceDetails/traceModels/traceTree';
import type {TracePreferencesState} from 'sentry/views/performance/newTraceDetails/traceState/tracePreferences';
import {getInitialTracePreferences} from 'sentry/views/performance/newTraceDetails/traceState/tracePreferences';
import {TraceStateProvider} from 'sentry/views/performance/newTraceDetails/traceState/traceStateProvider';
import {TraceWaterfall} from 'sentry/views/performance/newTraceDetails/traceWaterfall';
import {useTraceWaterfallModels} from 'sentry/views/performance/newTraceDetails/useTraceWaterfallModels';
import {useTraceWaterfallScroll} from 'sentry/views/performance/newTraceDetails/useTraceWaterfallScroll';
import TraceView, {
  StyledTracePanel,
} from 'sentry/views/performance/traceDetails/traceView';
import {hasTraceData} from 'sentry/views/performance/traceDetails/utils';
import EmptyState from 'sentry/views/replays/detail/emptyState';
import FluidHeight from 'sentry/views/replays/detail/layout/fluidHeight';
import {
  useFetchTransactions,
  useTransactionData,
} from 'sentry/views/replays/detail/trace/replayTransactionContext';
import type {ReplayRecord} from 'sentry/views/replays/types';

import {useReplayTraces} from './useReplayTraces';

function TracesNotFound({performanceActive}: {performanceActive: boolean}) {
  // We want to send the 'trace_status' data if the project actively uses and has access to the performance monitoring.
  useRouteAnalyticsParams(performanceActive ? {trace_status: 'trace missing'} : {});

  return (
    <BorderedSection data-test-id="replay-details-trace-tab">
      <EmptyState data-test-id="empty-state">
        <p>{t('No traces found')}</p>
      </EmptyState>
    </BorderedSection>
  );
}

function TraceFound({
  organization,
  performanceActive,
  eventView,
  traces,
  orphanErrors,
}: {
  eventView: EventView | null;
  organization: Organization;
  performanceActive: boolean;
  traces: TraceTree.Transaction[] | null;
  orphanErrors?: TraceError[];
}) {
  const location = useLocation();

  // We want to send the 'trace_status' data if the project actively uses and has access to the performance monitoring.
  useRouteAnalyticsParams(performanceActive ? {trace_status: 'success'} : {});

  return (
    <OverflowScrollBorderedSection>
      <TraceView
        meta={null}
        traces={traces || []}
        location={location}
        organization={organization}
        traceEventView={eventView!}
        traceSlug="Replay"
        orphanErrors={orphanErrors}
      />
    </OverflowScrollBorderedSection>
  );
}

const DEFAULT_REPLAY_TRACE_VIEW_PREFERENCES: TracePreferencesState = {
  drawer: {
    minimized: false,
    sizes: {
      'drawer left': 0.33,
      'drawer right': 0.33,
      'drawer bottom': 0.4,
      'trace grid height': 330,
    },
    layoutOptions: [],
  },
  missing_instrumentation: true,
  autogroup: {
    parent: true,
    sibling: true,
  },
  layout: 'drawer bottom',
  list: {
    width: 0.5,
  },
};

function Trace({replay}: {replay: undefined | ReplayRecord}) {
  const organization = useOrganization();
  const {projects} = useProjects();
  const {
    state: {didInit, errors, isFetching, traces, orphanErrors},
    eventView,
  } = useTransactionData();

  useFetchTransactions();

  if (errors.length) {
    // Same style as <EmptyStateWarning>
    return (
      <BorderedSection>
        <EmptyState withIcon={false}>
          <IconSad legacySize="54px" />
          <p>{t('Unable to retrieve traces')}</p>
        </EmptyState>
      </BorderedSection>
    );
  }

  if (!replay || !didInit || (isFetching && !traces?.length) || !eventView) {
    // Show the blank screen until we start fetching, thats when you get a spinner
    return (
      <StyledPlaceholder height="100%">
        {isFetching ? <Loading /> : null}
      </StyledPlaceholder>
    );
  }

  const project = projects.find(p => p.id === replay.project_id);
  const hasPerformance = project?.firstTransactionEvent === true;
  const performanceActive =
    organization.features.includes('performance-view') && hasPerformance;

  if (!hasTraceData(traces, orphanErrors)) {
    return <TracesNotFound performanceActive={performanceActive} />;
  }

  return (
    <TraceFound
      performanceActive={performanceActive}
      organization={organization}
      eventView={eventView}
      traces={(traces as TraceTree.Transaction[]) ?? []}
      orphanErrors={orphanErrors}
    />
  );
}

const REPLAY_TRACE_WATERFALL_PREFERENCES_KEY = 'replay-trace-waterfall-preferences';

export function NewTraceView({replay}: {replay: undefined | ReplayRecord}) {
  const preferences = useMemo(
    () =>
      getInitialTracePreferences(
        REPLAY_TRACE_WATERFALL_PREFERENCES_KEY,
        DEFAULT_REPLAY_TRACE_VIEW_PREFERENCES
      ),
    []
  );

  return (
    <TraceStateProvider
      initialPreferences={preferences}
      preferencesStorageKey={REPLAY_TRACE_WATERFALL_PREFERENCES_KEY}
    >
      <NewTraceViewImpl replay={replay} />
    </TraceStateProvider>
  );
}

function NewTraceViewImpl({replay}: {replay: undefined | ReplayRecord}) {
  const organization = useOrganization();
  const {projects} = useProjects();
  const {eventView, indexComplete, indexError, replayTraces} = useReplayTraces({
    replayRecord: replay,
  });

  const firstTrace = replayTraces?.[0];
  const trace = useTrace({
    traceSlug: firstTrace?.traceSlug,
    timestamp: firstTrace?.timestamp,
  });
  const meta = useReplayTraceMeta(replay);
  const tree = useTraceTree({
    trace,
    meta,
    replay: replay ?? null,
  });
  const rootEvent = useTraceRootEvent({
    tree,
    logs: undefined,
    traceId: firstTrace?.traceSlug ?? '',
  });

  const traceWaterfallModels = useTraceWaterfallModels();
  const traceWaterfallScroll = useTraceWaterfallScroll({
    organization,
    tree,
    viewManager: traceWaterfallModels.viewManager,
  });

  const otherReplayTraces = useMemo(() => {
    if (!replayTraces) {
      return [];
    }
    return replayTraces.slice(1);
  }, [replayTraces]);

  if (indexError) {
    // Same style as <EmptyStateWarning>
    return (
      <BorderedSection>
        <EmptyState withIcon={false}>
          <IconSad legacySize="54px" />
          <p>{t('Unable to retrieve traces')}</p>
        </EmptyState>
      </BorderedSection>
    );
  }

  if (!replay || !indexComplete || !replayTraces || !eventView) {
    // Show the blank screen until we start fetching, thats when you get a spinner
    return (
      <StyledPlaceholder height="100%">
        {indexComplete ? null : <Loading />}
      </StyledPlaceholder>
    );
  }

  const project = projects.find(p => p.id === replay.project_id);
  const hasPerformance = project?.firstTransactionEvent === true;
  const performanceActive =
    organization.features.includes('performance-view') && hasPerformance;

  if (!firstTrace) {
    return <TracesNotFound performanceActive={performanceActive} />;
  }

  return (
    <TraceViewWaterfallWrapper>
      <TraceWaterfall
        traceSlug={firstTrace.traceSlug}
        trace={trace}
        tree={tree}
        rootEventResults={rootEvent}
        replayTraces={otherReplayTraces}
        organization={organization}
        traceEventView={eventView}
        meta={meta}
        source="replay"
        replay={replay}
        traceWaterfallScrollHandlers={traceWaterfallScroll}
        traceWaterfallModels={traceWaterfallModels}
      />
    </TraceViewWaterfallWrapper>
  );
}

// This has the gray background, to match other loaders on Replay Details
const StyledPlaceholder = styled(Placeholder)`
  border: 1px solid ${p => p.theme.border};
  border-radius: ${p => p.theme.borderRadius};
`;

// White background, to match the loaded component
const BorderedSection = styled(FluidHeight)`
  border: 1px solid ${p => p.theme.border};
  border-radius: ${p => p.theme.borderRadius};
`;

const OverflowScrollBorderedSection = styled(BorderedSection)`
  overflow: scroll;

  ${StyledTracePanel} {
    border: none;
  }
`;

const TraceViewWaterfallWrapper = styled('div')`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

export default Trace;
