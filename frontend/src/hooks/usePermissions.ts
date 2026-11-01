import { useAuthStore } from '../store/authStore'

/**
 * Returns permission helpers based on the logged-in user.
 *
 * Permission rules:
 *  - Admins (role === 'admin') can manage ALL masters.
 *  - Users with can_manage_all_masters flag also have full access.
 *  - Other users can only add masters for categories they are assigned to
 *    (controlled via User Settings → Category Permissions).
 */
export function usePermissions() {
  const user = useAuthStore(s => s.user)

  const is_admin = user?.role === 'admin' || user?.can_manage_all_masters === true

  /**
   * Returns true if the user can add/create master records for the given category.
   * @param category_id  The product category currently selected (0 / undefined = not selected)
   */
  function can_add_master(category_id?: number): boolean {
    if (!user) return false
    if (is_admin) return true
    if (!user.allowed_category_ids || user.allowed_category_ids.length === 0) return false
    // If a category is selected, check if user is allowed for it
    if (category_id) return user.allowed_category_ids.includes(category_id)
    // If no category selected yet, show button if user has ANY category permission
    return user.allowed_category_ids.length > 0
  }

  /** True if user can manage masters that are NOT category-specific (Group, Variant, Flavour…) */
  function can_add_global_master(): boolean {
    if (!user) return false
    return is_admin
  }

  /** Returns true if the user is allowed to see cost/margin details */
  function can_view_margins(): boolean {
    if (!user) return false
    return is_admin || user.role === 'manager'
  }

  return { is_admin, can_add_master, can_add_global_master, can_view_margins, user }
}
