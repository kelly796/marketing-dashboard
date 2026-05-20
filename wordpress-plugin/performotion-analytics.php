<?php
add_action('rest_api_init', function () {
    register_rest_route('performotion/v1', '/analytics', [
        'methods'             => 'GET',
        'callback'            => 'pm_analytics_v2',
        'permission_callback' => '__return_true',
    ]);
});

function pm_analytics_v2(WP_REST_Request $request) {
    global $wpdb;

    $prefix          = $wpdb->prefix;
    $views_table     = $prefix . 'independent_analytics_views';
    $sessions_table  = $prefix . 'independent_analytics_sessions';
    $resources_table = $prefix . 'independent_analytics_resources';
    $referrers_table = $prefix . 'independent_analytics_referrers';
    $visitors_table  = $prefix . 'independent_analytics_visitors';

    // Detect date column name (created_at vs viewed_at vs timestamp)
    $columns  = $wpdb->get_col("SHOW COLUMNS FROM {$views_table}");
    $date_col = 'created_at';
    foreach (['created_at','viewed_at','timestamp','date'] as $c) {
        if (in_array($c, $columns)) { $date_col = $c; break; }
    }
    // Detect visitor/session identifier
    $visitor_col = 'visitor_id';
    foreach (['visitor_id','session_id','user_id'] as $c) {
        if (in_array($c, $columns)) { $visitor_col = $c; break; }
    }

    $today  = current_time('Y-m-d');
    $d30ago = date('Y-m-d', strtotime('-30 days', strtotime($today)));
    $d60ago = date('Y-m-d', strtotime('-60 days', strtotime($today)));
    $d31ago = date('Y-m-d', strtotime('-31 days', strtotime($today)));

    // Current 30 days
    $current = $wpdb->get_row($wpdb->prepare(
        "SELECT COUNT(*) as views, COUNT(DISTINCT {$visitor_col}) as visitors
         FROM {$views_table}
         WHERE DATE({$date_col}) BETWEEN %s AND %s",
        $d30ago, $today
    ));

    // Previous 30-60 days
    $previous = $wpdb->get_row($wpdb->prepare(
        "SELECT COUNT(*) as views, COUNT(DISTINCT {$visitor_col}) as visitors
         FROM {$views_table}
         WHERE DATE({$date_col}) BETWEEN %s AND %s",
        $d60ago, $d31ago
    ));

    // Daily trend — last 30 days
    $daily_rows = $wpdb->get_results($wpdb->prepare(
        "SELECT DATE({$date_col}) as date, COUNT(*) as views, COUNT(DISTINCT {$visitor_col}) as visitors
         FROM {$views_table}
         WHERE DATE({$date_col}) BETWEEN %s AND %s
         GROUP BY DATE({$date_col}) ORDER BY date ASC",
        $d30ago, $today
    ));
    $daily_map = [];
    foreach ($daily_rows as $row) $daily_map[$row->date] = $row;
    $trend_views = $trend_visitors = [];
    for ($i = 29; $i >= 0; $i--) {
        $d = date('Y-m-d', strtotime("-{$i} days", strtotime($today)));
        $trend_views[]    = isset($daily_map[$d]) ? (int)$daily_map[$d]->views    : 0;
        $trend_visitors[] = isset($daily_map[$d]) ? (int)$daily_map[$d]->visitors : 0;
    }

    // Top pages
    $top_pages = [];
    $res_cols  = $wpdb->get_col("SHOW COLUMNS FROM {$resources_table}");
    $url_col   = in_array('url',   $res_cols) ? 'url'   : (in_array('resource_url',   $res_cols) ? 'resource_url'   : 'id');
    $title_col = in_array('title', $res_cols) ? 'title' : (in_array('resource_title', $res_cols) ? 'resource_title' : 'id');
    $pages_raw = $wpdb->get_results($wpdb->prepare(
        "SELECT r.{$url_col} as url, r.{$title_col} as title,
                COUNT(v.id) as views, COUNT(DISTINCT v.{$visitor_col}) as visitors
         FROM {$views_table} v
         LEFT JOIN {$resources_table} r ON v.resource_id = r.id
         WHERE DATE(v.{$date_col}) BETWEEN %s AND %s
         GROUP BY v.resource_id ORDER BY views DESC LIMIT 10",
        $d30ago, $today
    ));
    foreach ($pages_raw as $p) {
        $top_pages[] = ['url' => (string)$p->url, 'title' => (string)($p->title ?: $p->url),
                        'views' => (int)$p->views, 'visitors' => (int)$p->visitors];
    }

    // Top referrers
    $top_referrers = [];
    $ref_cols   = $wpdb->get_col("SHOW COLUMNS FROM {$referrers_table}");
    $domain_col = in_array('domain', $ref_cols) ? 'domain' : (in_array('referrer_domain', $ref_cols) ? 'referrer_domain' : 'id');
    $refs_raw = $wpdb->get_results($wpdb->prepare(
        "SELECT r.{$domain_col} as source, COUNT(v.id) as views
         FROM {$views_table} v
         LEFT JOIN {$referrers_table} r ON v.referrer_id = r.id
         WHERE DATE(v.{$date_col}) BETWEEN %s AND %s
           AND r.{$domain_col} IS NOT NULL AND r.{$domain_col} != ''
         GROUP BY r.{$domain_col} ORDER BY views DESC LIMIT 10",
        $d30ago, $today
    ));
    foreach ($refs_raw as $r) {
        $top_referrers[] = ['source' => (string)$r->source, 'views' => (int)$r->views];
    }

    return rest_ensure_response([
        'views30d'        => (int)($current->views       ?? 0),
        'views30dPrev'    => (int)($previous->views      ?? 0),
        'visitors30d'     => (int)($current->visitors    ?? 0),
        'visitors30dPrev' => (int)($previous->visitors   ?? 0),
        'viewsTrend'      => $trend_views,
        'visitorsTrend'   => $trend_visitors,
        'topPages'        => $top_pages,
        'topReferrers'    => $top_referrers,
        'period'          => ['from' => $d30ago, 'to' => $today],
        'source'          => 'Independent Analytics',
    ]);
}
