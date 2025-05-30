import type {ComponentProps} from 'react';
import {useMemo} from 'react';
import styled from '@emotion/styled';

import type {Polarity} from 'sentry/components/percentChange';
import {space} from 'sentry/styles/space';
import type {NewQuery} from 'sentry/types/organization';
import type {MetaType} from 'sentry/utils/discover/eventView';
import EventView from 'sentry/utils/discover/eventView';
import type {DiscoverDatasets} from 'sentry/utils/discover/types';
import {MutableSearch} from 'sentry/utils/tokenizeSearch';
import {useLocation} from 'sentry/utils/useLocation';
import usePageFilters from 'sentry/utils/usePageFilters';
import {MetricReadout} from 'sentry/views/insights/common/components/metricReadout';
import {ReadoutRibbon} from 'sentry/views/insights/common/components/ribbon';
import {useEAPSpans} from 'sentry/views/insights/common/queries/useDiscover';
import {useReleaseSelection} from 'sentry/views/insights/common/queries/useReleases';
import {appendReleaseFilters} from 'sentry/views/insights/common/utils/releaseComparison';
import {useInsightsEap} from 'sentry/views/insights/common/utils/useEap';
import useCrossPlatformProject from 'sentry/views/insights/mobile/common/queries/useCrossPlatformProject';
import {useTableQuery} from 'sentry/views/insights/mobile/screenload/components/tables/screensTable';
import type {EAPSpanProperty} from 'sentry/views/insights/types';

type TableData = {
  data: Array<Record<string, any>>;
  meta?: MetaType;
};

interface BlockProps {
  dataKey: string | ((data?: TableData['data']) => number | undefined);
  title: string;
  unit: ComponentProps<typeof MetricReadout>['unit'];
  allowZero?: boolean;
  preferredPolarity?: Polarity;
}

export function MobileMetricsRibbon({
  filters,
  blocks,
  fields,
  referrer,
  dataset,
}: {
  blocks: BlockProps[];
  dataset: DiscoverDatasets;
  fields: EAPSpanProperty[];
  referrer: string;
  filters?: string[];
}) {
  const {selection} = usePageFilters();
  const location = useLocation();
  const useEap = useInsightsEap();

  const {
    primaryRelease,
    secondaryRelease,
    isLoading: isReleasesLoading,
  } = useReleaseSelection();

  const {isProjectCrossPlatform, selectedPlatform} = useCrossPlatformProject();

  const queryString = useMemo(() => {
    const searchQuery = new MutableSearch([...(filters ?? [])]);

    if (isProjectCrossPlatform) {
      searchQuery.addFilterValue('os.name', selectedPlatform);
    }

    return appendReleaseFilters(searchQuery, primaryRelease, secondaryRelease);
  }, [
    filters,
    isProjectCrossPlatform,
    primaryRelease,
    secondaryRelease,
    selectedPlatform,
  ]);

  const newQuery: NewQuery = {
    name: 'ScreenMetricsRibbon',
    fields,
    query: queryString,
    dataset,
    version: 2,
    projects: selection.projects,
  };
  const eventView = EventView.fromNewQueryWithLocation(newQuery, location);

  const eapResult = useEAPSpans(
    {
      fields,
      search: queryString,
      enabled: useEap && !isReleasesLoading,
    },
    referrer
  );

  const tableResult = useTableQuery({
    eventView,
    enabled: !useEap && !isReleasesLoading,
    referrer,
  });

  const isPending = useEap ? eapResult.isPending : tableResult.isPending;

  const data = {
    data: useEap ? eapResult.data : tableResult.data?.data || [],
    meta: useEap ? eapResult.meta : tableResult.data?.meta,
  };

  return (
    <StyledReadoutRibbon>
      {blocks.map(({title, dataKey, unit, preferredPolarity}) => (
        <MetricsBlock
          key={title}
          title={title}
          unit={unit}
          dataKey={dataKey}
          data={data}
          isLoading={isPending}
          preferredPolarity={preferredPolarity}
        />
      ))}
    </StyledReadoutRibbon>
  );
}

const StyledReadoutRibbon = styled(ReadoutRibbon)`
  margin-bottom: ${space(2)};
`;

function MetricsBlock({
  title,
  unit,
  data,
  dataKey,
  isLoading,
  allowZero,
  preferredPolarity,
}: {
  data: TableData;
  isLoading: boolean;
  title: string;
  release?: string;
} & BlockProps) {
  const value =
    typeof dataKey === 'function'
      ? dataKey(data.data)
      : (data?.data?.[0]?.[dataKey] as number);

  const hasData = (value && value !== 0) || (value === 0 && allowZero);

  return (
    <MetricReadout
      title={title}
      value={hasData ? value : undefined}
      isLoading={isLoading}
      unit={unit}
      preferredPolarity={preferredPolarity}
    />
  );
}
