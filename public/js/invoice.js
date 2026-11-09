$(function () {
  $('#printBtn').on('click', () => window.print());

  $('#cancelBtn').on('click', function () {
    const id = $(this).data('id');
    if (!confirm('Cancel this invoice? Its cases become unbilled again. The invoice number is not reused.')) return;
    $.ajax({ url: `/api/invoices/${id}`, method: 'DELETE' })
      .done(() => (location.href = '/invoices'))
      .fail((xhr) => alert(xhr.responseJSON?.error ?? 'Something went wrong'));
  });
});
